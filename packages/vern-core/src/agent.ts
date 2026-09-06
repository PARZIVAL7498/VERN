/**
 * TensorMux-compatible chat helper (OpenAI SDK-style fetch).
 * Used optionally to narrate explain text for decisions.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface TensorMuxChatOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  apiKey?: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

const DEFAULT_BASE = 'https://api.tensormux.com/v1';
const DEFAULT_MODEL = 'glm-4-7-flash';

export function getTensorMuxConfig(): { baseUrl: string; apiKey: string | undefined; model: string } {
  return {
    baseUrl: process.env.TENSORMUX_BASE_URL || DEFAULT_BASE,
    apiKey: process.env.TENSORMUX_API_KEY || process.env.OPENAI_API_KEY,
    model: process.env.TENSORMUX_MODEL || DEFAULT_MODEL,
  };
}

export async function tensorMuxChat(
  options: TensorMuxChatOptions,
): Promise<ChatCompletionResponse> {
  const cfg = getTensorMuxConfig();
  const apiKey = options.apiKey ?? cfg.apiKey;
  const baseUrl = (options.baseUrl ?? cfg.baseUrl).replace(/\/$/, '');
  const model = options.model ?? cfg.model;

  if (!apiKey) {
    const content = deterministicNarrationFromMessages(options.messages);
    return {
      id: `local-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'deterministic-template',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
    };
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TensorMux chat failed: ${res.status} ${body.slice(0, 200)}`);
  }

  return (await res.json()) as ChatCompletionResponse;
}

export interface NarrateExplainInput {
  invoiceNumber: string;
  outcome: string;
  confidence: number;
  reasoning: string[];
  fraudSignals: string[];
  guardrailHits: string[];
}

export async function narrateExplain(input: NarrateExplainInput): Promise<string> {
  const cfg = getTensorMuxConfig();
  if (!cfg.apiKey) {
    return deterministicExplain(input);
  }

  try {
    const completion = await tensorMuxChat({
      messages: [
        {
          role: 'system',
          content:
            'You are VERN, an AP invoice governance narrator. Be concise, factual, and cite guardrails/fraud signals. Never suggest disabling guardrails.',
        },
        {
          role: 'user',
          content: JSON.stringify(input),
        },
      ],
    });
    return completion.choices[0]?.message.content?.trim() || deterministicExplain(input);
  } catch {
    return deterministicExplain(input);
  }
}

export function deterministicExplain(input: NarrateExplainInput): string {
  const parts = [
    `Invoice ${input.invoiceNumber} routed to ${input.outcome}`,
    `with confidence ${(input.confidence * 100).toFixed(1)}%.`,
  ];
  if (input.guardrailHits.length) {
    parts.push(`Hard guardrails triggered: ${input.guardrailHits.join(', ')}.`);
  }
  if (input.fraudSignals.length) {
    parts.push(`Fraud signals: ${input.fraudSignals.join(', ')}.`);
  }
  if (input.reasoning.length) {
    parts.push(`Key reasons: ${input.reasoning.slice(0, 5).join('; ')}.`);
  }
  parts.push('Guardrails cannot be disabled by the LLM.');
  return parts.join(' ');
}

function deterministicNarrationFromMessages(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return 'No narration available.';
  try {
    const parsed = JSON.parse(lastUser.content) as NarrateExplainInput;
    if (parsed.invoiceNumber && parsed.outcome) {
      return deterministicExplain(parsed);
    }
  } catch {
    // fall through
  }
  return `VERN narrative: ${lastUser.content.slice(0, 500)}`;
}
