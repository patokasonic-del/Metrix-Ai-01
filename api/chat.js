const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const UPSTREAM_TIMEOUT_MS = 18000;

function buildSystemInstruction(selectedUnit = 'General Academic Studies') {
  return `You are Matrix AI (Metrix AI 01), an academic tutor created by Patrick Njoroge at Structura Digital Solutions (Digital solution agency), designed to help university and college students—especially in Kenyan universities (such as Murang'a University, JKUAT, UoN, TUK, KU, Egerton, and CUE/TVET engineering curricula).

ACTIVE SELECTED UNIT: ${selectedUnit}
- Prioritize accurate, exam-focused mastery of "${selectedUnit}" while supporting all core student subjects.

STRICT IDENTITY RULES:
- Your name is Matrix AI (Metrix AI 01).
- If anyone asks who made you, who created you, who owns you, what model you are, or anything similar, answer that you are Matrix AI (Metrix AI 01), created by Patrick Njoroge at Structura Digital Solutions, to support students in computer programming, engineering physics, chemistry, mathematics, academic writing, engineering drawing, and their selected university units.
- Never say or imply that you are Qwen, GPT, OpenAI, Llama, Groq, Grok, Claude, Gemini, or any other model or company.

STRICT COMMAND-MATCHING RULES:
- Match the student's exact command strictly and concisely. Do NOT add unnecessary fluff, unrequested examples, or long introductions/outros (never start with "Sure! Here is..." or end with summary filler).
- If the student asks to "State" or "Define" something: Output ONLY the direct statement or definition. Do not add explanations, examples, or extra commentary.
- If the student asks to "Explain" something: Give a clear, direct, and concise explanation without unrelated tangents or filler.
- If the student asks to "State and explain" something: First give the exact statement/definition, then give a clear, focused explanation—nothing extra.
- If the student asks a direct question, image question, or calculation: Give the direct answer or clean step-by-step solution without unnecessary intros or long conclusions.
- Only provide deeper detail, past-paper questions, or extra examples if the student explicitly asks for them.

ENGINEERING DRAWING — STEP-BY-STEP CONSTRUCTION + ACTUAL INTERPENETRATING CURVES VISUAL:
- Never invent non-existent geometric features, fake parts, or imaginary lines.
- When a student asks how to solve or draw an Engineering Drawing problem (such as curves of interpenetration between two intersecting solids/cylinders/prisms, orthographic projection, isometric views, or sectioning):
  1. First, provide a clear, numbered step-by-step construction guide explaining the exact procedure from start to finish (including reference line XY, projection lines, cutting planes/section lines, finding intersection points, and transferring true/projected points).
  2. Next, when the student asks for a diagram/visual or asks how an interpenetrating curve looks, render an actual, clear technical diagram inside a \`\`\`svg fenced code block showing the interpenetrating curves clearly (along with clean orthographic/projection layout details, XY reference line, labeled intersection points such as 1, 2, 3... / a', b', c', centerlines, and hidden/visible edges) rather than random or imaginary shapes.`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildGeminiContents(historyTurns, resolvedUserText, imageBase64, mimeType) {
  const latestParts = [];
  if (resolvedUserText) {
    latestParts.push({ text: resolvedUserText });
  }
  if (imageBase64 && mimeType) {
    latestParts.push({
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    });
  }

  if (historyTurns.length > 0 && historyTurns[historyTurns.length - 1].role === 'user') {
    return [
      ...historyTurns.slice(0, -1),
      { role: 'user', parts: latestParts },
    ];
  }
  return [
    ...historyTurns,
    { role: 'user', parts: latestParts },
  ];
}

async function callGemini({ apiKey, model, selectedUnit, historyTurns, resolvedUserText, imageBase64, mimeType }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const contents = buildGeminiContents(historyTurns, resolvedUserText, imageBase64, mimeType);

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: buildSystemInstruction(selectedUnit) }],
      },
      contents,
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 1500,
      },
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const errMsg = data?.error?.message || `Gemini returned status ${response.status}.`;
    const err = new Error(errMsg);
    err.status = response.status;
    throw err;
  }

  const parts = data?.candidates?.[0]?.content?.parts;
  const reply = Array.isArray(parts)
    ? parts
        .map((p) => (typeof p?.text === 'string' ? p.text : ''))
        .join('')
        .trim()
    : '';

  if (!reply) {
    throw new Error('Received an empty response from Gemini.');
  }
  return reply;
}

function normalizeGroqModel(rawModel, fallback) {
  const cleaned = String(rawModel || '').trim().replace(/versalite/gi, 'versatile');
  return cleaned || fallback;
}

async function callGroq({ apiKey, selectedUnit, historyMessages, resolvedUserText, imageBase64, mimeType }) {
  const latestUserContent =
    imageBase64 && mimeType
      ? [
          { type: 'text', text: resolvedUserText },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
            },
          },
        ]
      : resolvedUserText;

  const messagesPayload =
    historyMessages.length > 0 && historyMessages[historyMessages.length - 1].role === 'user'
      ? [
          { role: 'system', content: buildSystemInstruction(selectedUnit) },
          ...historyMessages.slice(0, -1),
          { role: 'user', content: latestUserContent },
        ]
      : [
          { role: 'system', content: buildSystemInstruction(selectedUnit) },
          ...historyMessages,
          { role: 'user', content: latestUserContent },
        ];

  const model = imageBase64
    ? normalizeGroqModel(process.env.GROQ_VISION_MODEL, 'meta-llama/llama-4-scout-17b-16e-instruct')
    : normalizeGroqModel(process.env.GROQ_MODEL, 'llama-3.3-70b-versatile');

  const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: messagesPayload,
      temperature: 0.25,
      max_tokens: 1500,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const errMsg = data?.error?.message || `Groq returned status ${response.status}.`;
    const err = new Error(errMsg);
    err.status = response.status;
    throw err;
  }

  let reply = data?.choices?.[0]?.message?.content?.trim() || '';
  reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!reply) {
    throw new Error('Received an empty response from Groq.');
  }
  return reply;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const geminiApiKey = (process.env.GEMINI_API_KEY || '').trim();
  const groqApiKey = (process.env.GROQ_API_KEY || '').trim();

  if (!geminiApiKey && !groqApiKey) {
    return res.status(500).json({
      error: 'Server configuration error: neither GEMINI_API_KEY nor GROQ_API_KEY is configured in Vercel.',
    });
  }

  const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const rawUnit = body?.unit || body?.selectedUnit || '';
    const selectedUnit =
      typeof rawUnit === 'string' && rawUnit.trim()
        ? rawUnit.trim().slice(0, 120)
        : 'General Academic Studies';

    const imageBase64 =
      typeof body?.imageBase64 === 'string' && body.imageBase64.trim()
        ? body.imageBase64.trim()
        : null;
    const mimeType =
      typeof body?.mimeType === 'string' && ALLOWED_IMAGE_MIME_TYPES.includes(body.mimeType.trim())
        ? body.mimeType.trim()
        : null;

    if (imageBase64 && !mimeType) {
      return res.status(400).json({
        error: 'Unsupported image format. Please upload a JPEG, PNG, or WebP image.',
      });
    }

    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
    const directMessage = typeof body?.message === 'string' ? body.message.trim() : '';

    // Send up to last 8 turns to keep latency low
    const historyMessages = rawMessages
      .filter(
        (msg) =>
          msg &&
          (msg.role === 'user' || msg.role === 'assistant') &&
          typeof msg.content === 'string' &&
          msg.content.trim().length > 0
      )
      .slice(-8)
      .map((msg) => ({
        role: msg.role,
        content: msg.content.trim(),
      }));

    const historyTurns = historyMessages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const resolvedUserText =
      directMessage ||
      (imageBase64 ? 'Analyze this image and answer based on the selected unit.' : '');

    if (historyMessages.length === 0 && !resolvedUserText && !imageBase64) {
      return res.status(400).json({ error: 'Please enter a message or upload an image.' });
    }

    if (geminiApiKey) {
      try {
        const reply = await callGemini({
          apiKey: geminiApiKey,
          model: geminiModel,
          selectedUnit,
          historyTurns,
          resolvedUserText,
          imageBase64,
          mimeType,
        });
        return res.status(200).json({ reply });
      } catch (geminiErr) {
        if (!groqApiKey) {
          throw geminiErr;
        }
      }
    }

    const reply = await callGroq({
      apiKey: groqApiKey,
      selectedUnit,
      historyMessages,
      resolvedUserText,
      imageBase64,
      mimeType,
    });

    return res.status(200).json({ reply });
  } catch (error) {
    const message =
      error?.name === 'AbortError'
        ? 'The AI request timed out. Please try a shorter prompt or try again.'
        : error?.message || 'An unexpected server error occurred while processing your request.';
    return res.status(500).json({ error: message });
  }
}
