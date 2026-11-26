const FREE_QUESTION_LIMIT = 10;
const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function supabaseRequest(path, options = {}) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      'Server configuration error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in Vercel.'
    );
  }

  const headers = {
    apikey: serviceKey,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...(options.headers || {}),
  };

  if (!serviceKey.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${serviceKey}`;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase error (${response.status})`);
  }
  return data;
}

function buildSystemInstruction(unit) {
  const cleanUnit = String(unit || 'General University Studies').trim();
  return [
    `You are Matrix AI, a helpful university study assistant for ${cleanUnit}.`,
    'Explain concepts clearly, step-by-step, with accurate formulas, definitions, and examples suited to university coursework.',
    'Keep responses well-structured and easy to follow.',
  ].join(' ');
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!geminiApiKey) {
    return res.status(500).json({
      error: 'Server configuration error: GEMINI_API_KEY is missing in Vercel environment variables.',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const email = String(body?.email || '').trim().toLowerCase();
    const promptText = String(body?.prompt || body?.message || '').trim();
    const selectedUnit = String(body?.selectedUnit || body?.unit || 'General Studies').trim();
    const deviceId = String(body?.deviceId || body?.device_id || '').trim().slice(0, 128) || null;
    const imageBase64 = String(body?.imageBase64 || '').trim();
    const imageMimeType = String(body?.imageMimeType || 'image/jpeg').trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
      return res.status(401).json({ error: 'Please sign in with your student email first.' });
    }

    if (!promptText && !imageBase64) {
      return res.status(400).json({ error: 'Please enter a question or attach an image.' });
    }

    // 1. Fetch student record from Supabase
    const rows = await supabaseRequest(
      `students?email=eq.${encodeURIComponent(email)}&select=*`
    );
    const student = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

    if (!student) {
      return res.status(404).json({
        error: 'Student account not found. Please sign in again.',
      });
    }

    const nowMs = Date.now();
    const passExpiresAtMs = student.pass_expires_at
      ? new Date(student.pass_expires_at).getTime()
      : 0;
    const hasActivePass = Number.isFinite(passExpiresAtMs) && passExpiresAtMs > nowMs;

    const studentQuestionsUsed = Number(student.questions_used || 0);
    let deviceQuestionsUsed = 0;

    // 2. Check all accounts tied to this device_id to prevent free-quota resets via email switching
    if (!hasActivePass && deviceId) {
      const deviceRows = await supabaseRequest(
        `students?device_id=eq.${encodeURIComponent(deviceId)}&select=email,questions_used,pass_expires_at`
      );
      if (Array.isArray(deviceRows) && deviceRows.length > 0) {
        const anyDevicePassActive = deviceRows.some((r) => {
          const exp = r.pass_expires_at ? new Date(r.pass_expires_at).getTime() : 0;
          return Number.isFinite(exp) && exp > nowMs;
        });

        if (!anyDevicePassActive) {
          deviceQuestionsUsed = deviceRows.reduce(
            (sum, r) => sum + Number(r.questions_used || 0),
            0
          );
        }
      }
    }

    const effectiveQuestionsUsed = Math.max(studentQuestionsUsed, deviceQuestionsUsed);

    if (!hasActivePass && effectiveQuestionsUsed >= FREE_QUESTION_LIMIT) {
      return res.status(402).json({
        code: 'FREE_LIMIT_REACHED',
        error:
          'You have used all 10 free questions on this device. Unlock a 24-hour pass for 10 KES to continue.',
        questionsUsed: effectiveQuestionsUsed,
        freeLimit: FREE_QUESTION_LIMIT,
        passExpiresAt: passExpiresAtMs || 0,
      });
    }

    // 3. Build Gemini request payload
    const userParts = [];
    if (promptText) {
      userParts.push({ text: promptText });
    }
    if (imageBase64) {
      userParts.push({
        inline_data: {
          mime_type: imageMimeType,
          data: imageBase64,
        },
      });
    }

    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey,
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: buildSystemInstruction(selectedUnit || student.selected_unit) }],
        },
        contents: [
          {
            role: 'user',
            parts: userParts,
          },
        ],
      }),
    });

    const geminiData = await geminiResponse.json().catch(() => null);
    if (!geminiResponse.ok) {
      const geminiErr =
        geminiData?.error?.message || `Gemini API error (${geminiResponse.status})`;
      return res.status(502).json({ error: geminiErr });
    }

    const replyText = extractGeminiText(geminiData);
    if (!replyText) {
      return res.status(502).json({ error: 'Received an empty response from Matrix AI.' });
    }

    // 4. Increment questions_used for non-pass questions and persist device_id
    const nextQuestionsUsed = hasActivePass
      ? studentQuestionsUsed
      : studentQuestionsUsed + 1;

    const patchPayload = {
      questions_used: nextQuestionsUsed,
      updated_at: new Date().toISOString(),
    };
    if (deviceId && !student.device_id) {
      patchPayload.device_id = deviceId;
    }

    await supabaseRequest(
      `students?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patchPayload),
      }
    ).catch(() => null);

    return res.status(200).json({
      reply: replyText,
      questionsUsed: hasActivePass
        ? effectiveQuestionsUsed
        : Math.max(nextQuestionsUsed, deviceQuestionsUsed),
      freeLimit: FREE_QUESTION_LIMIT,
      hasActivePass,
      passExpiresAt: passExpiresAtMs || 0,
    });
  } catch (error) {
    console.error('Matrix AI /api/chat error:', error);
    return res.status(500).json({
      error: error?.message || 'Could not process your question right now.',
    });
  }
}
