const FREE_QUESTION_LIMIT = 5;
const DAILY_TIME_ZONE = 'Africa/Nairobi';
const PRIMARY_GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';
const FALLBACK_GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
const GEMINI_TIMEOUT_MS = 9000;

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

function getDailyDayKey(timestampMs) {
  const dateObj = new Date(timestampMs);
  if (!Number.isFinite(dateObj.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dateObj);
  const year = parts.find((p) => p.type === 'year')?.value || '';
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const day = parts.find((p) => p.type === 'day')?.value || '';
  return `${year}-${month}-${day}`;
}

function isDailyFreeExpired(row, todayKey) {
  const rawUsed = Number(row?.questions_used || 0);
  if (rawUsed <= 0) return false;
  const updatedMs = row?.updated_at ? new Date(row.updated_at).getTime() : NaN;
  const windowStartMs = row?.free_window_started_at
    ? new Date(row.free_window_started_at).getTime()
    : NaN;
  const referenceMs = Number.isFinite(updatedMs) ? updatedMs : windowStartMs;
  if (!Number.isFinite(referenceMs)) return true;
  return getDailyDayKey(referenceMs) !== todayKey;
}

function getEffectiveDailyUsage(row, todayKey) {
  const rawUsed = Number(row?.questions_used || 0);
  if (isDailyFreeExpired(row, todayKey)) {
    return 0;
  }
  return rawUsed;
}

function buildAdaptationInstruction(promptText = '') {
  const cleanPrompt = String(promptText || '').trim();
  const wantsStatementOnly =
    /\b(only (a |the )?statement|just (a |the )?statement|state only|give me (the |a )?statement|statement only|in one line|one sentence|short answer only|final answer only|just the answer|only the answer)\b/i.test(
      cleanPrompt
    );

  if (wantsStatementOnly) {
    return [
      'RESPONSE MODE: STATEMENT-ONLY.',
      'The student asked only for a statement or direct answer.',
      'Output ONLY the exact requested statement(s) clearly and concisely.',
      'Do NOT add introductory greetings, extra commentary, multi-step derivations, or long explanations unless explicitly asked.',
    ].join(' ');
  }

  const isShortLookup =
    cleanPrompt.length > 0 &&
    cleanPrompt.length <= 45 &&
    !/\b(explain|how|why|compare|debug|write|derive|walk me through|calculate|solve)\b/i.test(
      cleanPrompt
    );

  if (isShortLookup) {
    return [
      'RESPONSE MODE: ADAPTIVE CONCISE.',
      'Automatically adapt to the student’s concise request without manual settings.',
      'Give a clear, direct answer first and keep formatting brief unless deeper explanation is clearly needed.',
    ].join(' ');
  }

  return [
    'RESPONSE MODE: ADAPTIVE FULL.',
    'Automatically adapt to the student’s need without manual settings.',
    'Provide clear, accurate coursework guidance tailored to the student’s unit, keeping structure clean and avoiding unnecessary filler.',
    'When writing mathematical expressions, use clean LaTeX delimiters ($...$ for inline and $$...$$ for display math).',
  ].join(' ');
}

function buildSystemInstruction(unit, promptText = '') {
  const cleanUnit = String(unit || 'General University Studies').trim();
  return [
    `You are Matrix AI, a helpful university study assistant for ${cleanUnit}.`,
    'Tailor formulas, definitions, code, and examples to university coursework.',
    buildAdaptationInstruction(promptText),
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

async function fetchGeminiWithTimeout(url, geminiApiKey, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiApiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    return {
      ok: false,
      status: isTimeout ? 504 : 503,
      data: {
        error: {
          message: isTimeout
            ? 'Primary model timed out while responding.'
            : err?.message || 'Network error calling Gemini API.',
        },
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
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
    const rows = await supabaseRequest(`students?email=eq.${encodeURIComponent(email)}&select=*`);
    const student = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!student) {
      return res.status(404).json({
        error: 'Student account not found. Please sign in again.',
      });
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const todayKey = getDailyDayKey(nowMs);
    const passExpiresAtMs = student.pass_expires_at ? new Date(student.pass_expires_at).getTime() : 0;
    const hasActivePass = Number.isFinite(passExpiresAtMs) && passExpiresAtMs > nowMs;

    // 2. Daily reset (no rollover of unused free questions from prior days)
    const dailyExpired = isDailyFreeExpired(student, todayKey);
    const studentQuestionsUsed = dailyExpired ? 0 : Number(student.questions_used || 0);
    const windowStartIso =
      dailyExpired || !student.free_window_started_at ? nowIso : student.free_window_started_at;
    let deviceQuestionsUsed = 0;

    // 3. Check all accounts tied to this device_id for today's daily usage
    if (!hasActivePass && deviceId) {
      const deviceRows = await supabaseRequest(
        `students?device_id=eq.${encodeURIComponent(deviceId)}&select=email,questions_used,pass_expires_at,free_window_started_at,updated_at`
      );
      if (Array.isArray(deviceRows) && deviceRows.length > 0) {
        const anyDevicePassActive = deviceRows.some((r) => {
          const exp = r.pass_expires_at ? new Date(r.pass_expires_at).getTime() : 0;
          return Number.isFinite(exp) && exp > nowMs;
        });
        if (!anyDevicePassActive) {
          deviceQuestionsUsed = deviceRows.reduce(
            (sum, r) => sum + getEffectiveDailyUsage(r, todayKey),
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
          'You have used all 5 free questions for today. Unlock a 24-hour pass for 10 KES or wait for tomorrow’s automatic daily reset.',
        questionsUsed: effectiveQuestionsUsed,
        freeLimit: FREE_QUESTION_LIMIT,
        passExpiresAt: passExpiresAtMs || 0,
      });
    }

    // 4. Build Gemini request payload with automatic student adaptation
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

    const geminiPayload = {
      system_instruction: {
        parts: [
          {
            text: buildSystemInstruction(selectedUnit || student.selected_unit, promptText),
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: userParts,
        },
      ],
    };

    let attempt = await fetchGeminiWithTimeout(PRIMARY_GEMINI_URL, geminiApiKey, geminiPayload);
    let replyText = attempt.ok ? extractGeminiText(attempt.data) : '';

    const shouldFallback =
      !attempt.ok && (attempt.status === 429 || attempt.status === 503 || attempt.status === 504);

    if (shouldFallback) {
      attempt = await fetchGeminiWithTimeout(FALLBACK_GEMINI_URL, geminiApiKey, geminiPayload);
      replyText = attempt.ok ? extractGeminiText(attempt.data) : '';
    }

    if (!attempt.ok) {
      const geminiErr =
        attempt.data?.error?.message || `Gemini API error (${attempt.status})`;
      return res.status(502).json({ error: geminiErr });
    }

    if (!replyText) {
      return res.status(502).json({ error: 'Received an empty response from Matrix AI.' });
    }

    // 5. Update today's free counter in Supabase (resetting to 1 on a new day, never rolling over)
    const nextStudentQuestionsUsed = hasActivePass ? studentQuestionsUsed : studentQuestionsUsed + 1;
    const patchPayload = {
      questions_used: nextStudentQuestionsUsed,
      free_window_started_at: dailyExpired ? nowIso : windowStartIso,
      updated_at: nowIso,
    };
    if (deviceId && !student.device_id) {
      patchPayload.device_id = deviceId;
    }

    await supabaseRequest(`students?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      body: JSON.stringify(patchPayload),
    }).catch(() => null);

    const reportedQuestionsUsed = hasActivePass
      ? effectiveQuestionsUsed
      : Math.max(nextStudentQuestionsUsed, deviceQuestionsUsed);

    return res.status(200).json({
      reply: replyText,
      questionsUsed: reportedQuestionsUsed,
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
