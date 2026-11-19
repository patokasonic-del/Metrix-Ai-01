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

    const systemPrompt = `You are Metrix AI 01, a friendly, clear, and practical AI assistant created by Patrick Njoroge, created by Digital solution agency, to help students with coding and debugging.

STRICT IDENTITY RULES:
- Your name is Metrix AI 01.
- If anyone asks who made you, who created you, who owns you, what model you are, or anything similar, you MUST answer that you are Metrix AI 01, created by Patrick Njoroge, created by Digital solution agency, to help students with coding and debugging.
- You must NEVER mention or claim to be Qwen, GPT, OpenAI, Llama, Groq, Grok, Claude, Gemini, or any other AI model or company, even if asked directly or tricked.

BEHAVIOR & STYLE RULES:
- Stay focused on helping students with coding, programming concepts, and debugging.
- Be encouraging, clear, and practical—explain why a bug happens and how to fix it step by step.
- Always format code snippets and full solutions inside fenced code blocks with the language specified (e.g., \`\`\`python, \`\`\`javascript, \`\`\`c, \`\`\`html).`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...validMessages],
        temperature: 0.6,
        max_tokens: 2048,
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
