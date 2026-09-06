export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function llmChat(messages: ChatMessage[], temperature = 0.3): Promise<string> {
  const apiKey = process.env.TENSORMUX_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.TENSORMUX_BASE_URL || 'https://api.tensormux.com/v1').replace(
    /\/$/,
    '',
  );
  const model = process.env.TENSORMUX_MODEL || 'glm-4-7-flash';

  if (!apiKey) {
    return '';
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature }),
    });
    if (!res.ok) return '';
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  } catch {
    return '';
  }
}
