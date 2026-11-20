export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const apiKey = (process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(500).json({
      error: 'Server configuration error: GROQ_API_KEY is missing in environment variables.',
    });
  }

  const model = (process.env.GROQ_MODEL || 'openai/gpt-oss-120b').trim();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const rawMessages = body?.messages;
    const selectedUnit =
      typeof body?.selectedUnit === 'string' && body.selectedUnit.trim()
        ? body.selectedUnit.trim().slice(0, 120)
        : 'General Academic Studies';

    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return res.status(400).json({ error: 'Invalid request: messages array is required.' });
    }

    // Keep only the last 20 valid user/assistant messages
    const validMessages = rawMessages
      .filter(
        (msg) =>
          msg &&
          (msg.role === 'user' || msg.role === 'assistant') &&
          typeof msg.content === 'string' &&
          msg.content.trim().length > 0
      )
      .slice(-20)
      .map((msg) => ({
        role: msg.role,
        content: msg.content.trim(),
      }));

    if (validMessages.length === 0) {
      return res.status(400).json({ error: 'No valid user or assistant messages provided.' });
    }

    const systemPrompt = `You are Matrix AI (Metrix AI 01), an academic tutor created by Patrick Njoroge, created by Digital solution agency, designed to help university and college students—especially in Kenyan universities (such as Murang'a University, JKUAT, UoN, TUK, KU, Egerton, and CUE/TVET engineering curricula).

ACTIVE SELECTED UNIT: ${selectedUnit}
- Prioritize accurate, exam-focused mastery of "${selectedUnit}" while supporting all core student subjects.

STRICT IDENTITY RULES:
- Your name is Matrix AI (Metrix AI 01).
- If anyone asks who made you, who created you, who owns you, what model you are, or anything similar, answer that you are Matrix AI (Metrix AI 01), created by Patrick Njoroge, created by Digital solution agency, to support students in computer programming, engineering physics, chemistry, mathematics, academic writing, engineering drawing, and their selected university units.
- Never say or imply that you are Qwen, GPT, OpenAI, Llama, Groq, Grok, Claude, Gemini, or any other model or company.

STRICT COMMAND-MATCHING RULES:
- Match the student's exact command strictly and concisely. Do NOT add unnecessary fluff, unrequested examples, or long introductions/outros (never start with "Sure! Here is..." or end with summary filler).
- If the student asks to "State" or "Define" something: Output ONLY the direct statement or definition. Do not add explanations, examples, or extra commentary.
- If the student asks to "Explain" something: Give a clear, direct, and concise explanation without unrelated tangents or filler.
- If the student asks to "State and explain" something: First give the exact statement/definition, then give a clear, focused explanation—nothing extra.
- If the student asks a direct question or calculation: Give the direct answer or clean step-by-step solution without unnecessary intros or long conclusions.
- Only provide deeper detail, past-paper questions, or extra examples if the student explicitly asks for them.

ENGINEERING DRAWING — STEP-BY-STEP CONSTRUCTION + ACTUAL INTERPENETRATING CURVES VISUAL:
- Never invent non-existent geometric features, fake parts, or imaginary lines.
- When a student asks how to solve or draw an Engineering Drawing problem (such as curves of interpenetration between two intersecting solids/cylinders/prisms, orthographic projection, isometric views, or sectioning):
  1. First, provide a clear, numbered step-by-step construction guide explaining the exact procedure from start to finish (including reference line XY, projection lines, cutting planes/section lines, finding intersection points, and transferring true/projected points).
  2. Next, when the student asks for a diagram/visual or asks how an interpenetrating curve looks, render an actual, clear technical diagram inside a \`\`\`svg fenced code block showing the interpenetrating curves clearly (along with clean orthographic/projection layout details, XY reference line, labeled intersection points such as 1, 2, 3... / a', b', c', centerlines, and hidden/visible edges) rather than random or imaginary shapes.`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...validMessages],
        temperature: 0.25,
        max_tokens: 4096,
      }),
    });

    const data = await groqResponse.json().catch(() => null);

    if (!groqResponse.ok) {
      const apiErrMessage =
        data?.error?.message || `Upstream AI service returned status ${groqResponse.status}.`;
      return res.status(groqResponse.status).json({ error: apiErrMessage });
    }

    let reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      return res.status(502).json({ error: 'Received an empty response from the AI service.' });
    }

    // Remove any <think>...</think> reasoning blocks
    reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    return res.status(200).json({ reply });
  } catch (error) {
    console.error('Metrix AI 01 /api/chat error:', error);
    return res.status(500).json({
      error: 'An unexpected server error occurred while processing your request.',
    });
  }
}
