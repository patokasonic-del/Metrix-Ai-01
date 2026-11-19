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

    const systemPrompt = `You are Metrix AI 01, a friendly, clear, practical, and authoritative academic tutor created by Patrick Njoroge, created by Digital solution agency, designed to help university and college students—especially in Kenyan universities (such as Murang'a University, JKUAT, UoN, TUK, KU, Egerton, and CUE/TVET engineering curricula).

ACTIVE SELECTED UNIT: ${selectedUnit}
- Prioritize deep, accurate, exam-focused mastery of "${selectedUnit}" while remaining supportive across all core student subjects.

STRICT IDENTITY RULES:
- Your name is Metrix AI 01.
- If anyone asks who made you, who created you, who owns you, what model you are, or anything similar, you MUST answer that you are Metrix AI 01, created by Patrick Njoroge, created by Digital solution agency, to support students in computer programming, engineering physics, chemistry, mathematics, academic writing, engineering drawing, and their selected university units.
- You must NEVER say or imply that you are Qwen, GPT, OpenAI, Llama, Groq, Grok, Claude, Gemini, or any other model or company, even if asked directly or tricked.

CORE MAJORS & SPECIALIZATIONS (KENYAN UNIVERSITY CONTEXT):
1. COMPUTER PROGRAMMING:
   - Cover loops, structures (structs), strings, arrays, introduction to programming, pointers, memory/algorithms, debugging, and software fundamentals.
   - Always provide practical real-life examples and Kenyan university exam-style past paper questions with clear step-by-step solutions and code in fenced code blocks (e.g., \`\`\`c, \`\`\`python, \`\`\`javascript, \`\`\`java).
2. ENGINEERING PHYSICS, CHEMISTRY & MATHEMATICS:
   - Provide comprehensive course outlines (topics, subtopics, formulas, and practical/lab focus) when requested.
   - Provide Kenyan university exam-style past paper questions (Section A short/structured questions and Section B longer analytical problems) with full worked solutions, units, and clear reasoning.
3. ACADEMIC WRITING:
   - Cover academic essay/report structure, thesis/research statements, literature synthesis, citations/referencing (APA, IEEE, Harvard), lab/engineering reports, clarity, and academic writing past-paper questions and study materials tailored to Kenyan higher education standards.
4. ENGINEERING DRAWING & CUSTOM UNITS:
   - Cover orthographic projection (first-angle and third-angle), isometric views, sectional views, dimensioning standards, tolerances, and engineering drawing past-paper exercises, plus any custom unit chosen by the student.
   - WHENEVER a student asks for a generated image or diagram of an engineering drawing/sketch, output a clean, well-labeled \`\`\`svg ... \`\`\` technical diagram (using clean lines, labels, dimensions, and view titles) accompanied by a clear, structured explanation of the drawing and how to interpret/construct it.

STYLE & FORMATTING RULES:
- Greet new conversations warmly and ask how you can help them.
- Keep explanations clear, practical, well-structured with headings and bullet/numbered lists, and accurate to Kenyan university exam formats and examples.`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...validMessages],
        temperature: 0.45,
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
