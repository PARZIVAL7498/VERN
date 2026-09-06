import { llmChat, type ChatMessage } from './llm';
import type { JarvisStore } from './store';

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface JarvisChatResult {
  reply: string;
  toolCalls: ToolCallRecord[];
  needsConfirm?: { action: string; detail: string };
}

type ToolName =
  | 'get_briefing'
  | 'remember'
  | 'recall'
  | 'add_note'
  | 'list_notes'
  | 'add_reminder'
  | 'list_reminders'
  | 'complete_reminder'
  | 'draft_message'
  | 'get_time';

const TOOLS: ToolName[] = [
  'get_briefing',
  'remember',
  'recall',
  'add_note',
  'list_notes',
  'add_reminder',
  'list_reminders',
  'complete_reminder',
  'draft_message',
  'get_time',
];

function runTool(
  store: JarvisStore,
  name: ToolName,
  args: Record<string, unknown>,
): unknown {
  switch (name) {
    case 'get_time':
      return {
        iso: new Date().toISOString(),
        local: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      };
    case 'get_briefing':
      return store.briefing();
    case 'remember':
      return store.remember(String(args.key ?? 'note'), String(args.value ?? ''));
    case 'recall':
      return store.recall(args.query ? String(args.query) : undefined);
    case 'add_note':
      return store.addNote(String(args.title ?? 'Note'), String(args.body ?? args.text ?? ''));
    case 'list_notes':
      return store.listNotes();
    case 'add_reminder':
      return store.addReminder(
        String(args.text ?? args.title ?? 'Reminder'),
        args.when ? String(args.when) : undefined,
      );
    case 'list_reminders':
      return store.listReminders(Boolean(args.includeDone));
    case 'complete_reminder':
      return store.completeReminder(String(args.id ?? '')) ?? { error: 'not_found' };
    case 'draft_message':
      return {
        draft: true,
        to: String(args.to ?? ''),
        subject: String(args.subject ?? ''),
        body: String(args.body ?? ''),
        warning: 'Draft only — Jarvis will not send until you confirm outside this tool.',
      };
    default:
      return { error: 'unknown_tool' };
  }
}

/** Route user intent to a tool without an LLM (demo-safe). */
export function routeJarvisIntent(text: string): { tool: ToolName; args: Record<string, unknown> } {
  const q = text.toLowerCase();

  if (/(good\s*)?(morning|brief|status|what's up|whats up|hello|hi\b)/.test(q)) {
    return { tool: 'get_briefing', args: {} };
  }
  if (/\btime\b|\bdate\b|what day/.test(q)) {
    return { tool: 'get_time', args: {} };
  }
  if (/remember (that )?/.test(q) || /my name is/.test(q) || /i prefer/.test(q)) {
    const nameMatch = text.match(/my name is\s+([^,.]+)/i);
    if (nameMatch?.[1]) return { tool: 'remember', args: { key: 'user_name', value: nameMatch[1].trim() } };
    const prefer = text.match(/i prefer\s+(.+)/i);
    if (prefer?.[1]) return { tool: 'remember', args: { key: 'preference', value: prefer[1].trim() } };
    const rem = text.match(/remember (?:that )?(.+)/i);
    if (rem?.[1]) return { tool: 'remember', args: { key: 'memory', value: rem[1].trim() } };
    return { tool: 'remember', args: { key: 'memory', value: text } };
  }
  if (/what do you know|recall|what.?s my|who am i/.test(q)) {
    return { tool: 'recall', args: { query: text } };
  }
  if (/remind me|add reminder|set a reminder/.test(q)) {
    const cleaned = text.replace(/remind me to\s*/i, '').replace(/add reminder\s*/i, '').trim();
    return { tool: 'add_reminder', args: { text: cleaned || text } };
  }
  if (/list reminder|my reminders|show reminders/.test(q)) {
    return { tool: 'list_reminders', args: {} };
  }
  if (/take a note|add note|note that|write down/.test(q)) {
    const body = text.replace(/^(take a note|add note|note that|write down)[:\s]*/i, '').trim();
    return { tool: 'add_note', args: { title: 'Quick note', body: body || text } };
  }
  if (/list notes|my notes|show notes/.test(q)) {
    return { tool: 'list_notes', args: {} };
  }
  if (/draft (an? )?(email|message|msg)/.test(q)) {
    return {
      tool: 'draft_message',
      args: {
        to: '',
        subject: 'Draft from Jarvis',
        body: text.replace(/draft (an? )?(email|message|msg)\s*/i, '').trim() || text,
      },
    };
  }
  return { tool: 'get_briefing', args: {} };
}

function formatReply(tool: ToolName, result: unknown, userText: string): string {
  if (tool === 'get_briefing' && result && typeof result === 'object') {
    const b = result as {
      greeting: string;
      time: string;
      openReminders: Array<{ text: string; when: string }>;
      recentNotes: Array<{ title: string; body: string }>;
      facts: Array<{ key: string; value: string }>;
    };
    const rems =
      b.openReminders.length === 0
        ? 'No open reminders.'
        : b.openReminders.map((r) => `• ${r.text} (${new Date(r.when).toLocaleString('en-IN')})`).join('\n');
    const notes =
      b.recentNotes.length === 0
        ? 'No notes yet.'
        : b.recentNotes.map((n) => `• ${n.title}: ${n.body.slice(0, 80)}`).join('\n');
    return `${b.greeting} Local time ${b.time}.\n\nReminders:\n${rems}\n\nNotes:\n${notes}\n\nSay “remind me to…” or “remember that…” and I’ll handle it.`;
  }
  if (tool === 'get_time' && result && typeof result === 'object') {
    const t = result as { local: string };
    return `It’s ${t.local}.`;
  }
  if (tool === 'remember' && result && typeof result === 'object') {
    const f = result as { key: string; value: string };
    return `Got it. I’ll remember ${f.key}: “${f.value}”.`;
  }
  if (tool === 'recall' && Array.isArray(result)) {
    if (result.length === 0) return 'I don’t have anything stored on that yet.';
    return `Here’s what I know:\n${result.map((f: { key: string; value: string }) => `• ${f.key}: ${f.value}`).join('\n')}`;
  }
  if (tool === 'add_note' && result && typeof result === 'object') {
    const n = result as { title: string };
    return `Noted (“${n.title}”).`;
  }
  if (tool === 'list_notes' && Array.isArray(result)) {
    if (!result.length) return 'No notes yet.';
    return result
      .map((n: { title: string; body: string }) => `• ${n.title}: ${n.body}`)
      .join('\n');
  }
  if (tool === 'add_reminder' && result && typeof result === 'object') {
    const r = result as { text: string; when: string };
    return `Reminder set: “${r.text}” for ${new Date(r.when).toLocaleString('en-IN')}.`;
  }
  if (tool === 'list_reminders' && Array.isArray(result)) {
    if (!result.length) return 'You’re clear — no open reminders.';
    return result
      .map((r: { text: string; when: string }) => `• ${r.text} — ${new Date(r.when).toLocaleString('en-IN')}`)
      .join('\n');
  }
  if (tool === 'draft_message' && result && typeof result === 'object') {
    const d = result as { subject: string; body: string; warning: string };
    return `Draft ready (not sent):\nSubject: ${d.subject}\n\n${d.body}\n\n${d.warning}`;
  }
  return `Done (${tool}). You said: “${userText.slice(0, 80)}”.`;
}

const SYSTEM = `You are Jarvis, a concise personal assistant.
Reply with ONLY JSON: {"tool":"<name>","args":{...}}
Allowed tools: ${TOOLS.join(', ')}.
Never claim you sent email — draft_message only creates drafts.
Be decisive; prefer get_briefing for greetings.`;

export async function runJarvisChat(
  store: JarvisStore,
  userText: string,
): Promise<JarvisChatResult> {
  const routed = routeJarvisIntent(userText);
  let tool = routed.tool;
  let args = { ...routed.args };

  const llm = await llmChat([
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `User said: ${userText}\nKnown facts: ${JSON.stringify(store.recall().slice(0, 10))}`,
    },
  ]);

  if (llm) {
    try {
      const match = llm.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { tool?: string; args?: Record<string, unknown> };
        if (parsed.tool && (TOOLS as string[]).includes(parsed.tool)) {
          tool = parsed.tool as ToolName;
          args = { ...args, ...(parsed.args ?? {}) };
        }
      }
    } catch {
      // keep router
    }
  }

  const result = runTool(store, tool, args);
  let reply = formatReply(tool, result, userText);

  // Optional polish with LLM (narrate), still grounded in tool result
  const polish = await llmChat(
    [
      {
        role: 'system',
        content:
          'You are Jarvis. Rewrite the tool result as a short spoken reply (2-5 sentences). No JSON. Do not invent facts.',
      },
      {
        role: 'user',
        content: JSON.stringify({ userText, tool, result, draftReply: reply }),
      },
    ],
    0.4,
  );
  if (polish && polish.length > 10 && !polish.includes('{')) {
    reply = polish;
  }

  store.pushMessage('user', userText);
  store.pushMessage('assistant', reply);
  await store.persist();

  const needsConfirm =
    tool === 'draft_message'
      ? { action: 'send_message', detail: 'Confirm before sending any real email.' }
      : undefined;

  return {
    reply,
    toolCalls: [{ name: tool, args, result }],
    ...(needsConfirm ? { needsConfirm } : {}),
  };
}

export type { ChatMessage };
