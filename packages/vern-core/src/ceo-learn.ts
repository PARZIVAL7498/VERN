import { tensorMuxChat } from './agent.js';
import type { CeoThinkingProfile, PersonalStore } from './personal.js';
import process from 'node:process';

const LEARN_EVERY_N = Number(process.env.VERN_LEARN_EVERY_N ?? 3);
const LEARN_TIMEOUT_MS = Number(process.env.VERN_LEARN_TIMEOUT_MS ?? 10000);
const ENABLE_LEARN = process.env.VERN_LEARN !== '0';

const LEARN_SYSTEM = `You extract how a CEO thinks from chat. Return ONLY compact JSON (no markdown):
{
  "summary": "1-2 sentences on how they think and decide",
  "thinkingStyle": ["short tags"],
  "priorities": ["what they care about"],
  "decisionPatterns": ["how they decide under risk"],
  "ideationThemes": ["recurring ideas / mental models"],
  "communicationPrefs": ["how they want replies"]
}
Rules: only infer from evidence in the chat; max 4 items per array; empty arrays OK; never invent company facts.`;

function parseLearnJson(raw: string): Partial<CeoThinkingProfile> | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const arr = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.slice(0, 80)) : [];
    return {
      summary: typeof obj.summary === 'string' ? obj.summary.slice(0, 280) : undefined,
      thinkingStyle: arr(obj.thinkingStyle),
      priorities: arr(obj.priorities),
      decisionPatterns: arr(obj.decisionPatterns),
      ideationThemes: arr(obj.ideationThemes),
      communicationPrefs: arr(obj.communicationPrefs),
    };
  } catch {
    return null;
  }
}

/** Fast path: explicit preference language without waiting for a batch learn. */
export function harvestExplicitPrefs(userText: string, personal: PersonalStore): void {
  const t = userText.trim();
  if (!t) return;

  const prefer = t.match(/\bi (?:prefer|want|like)\s+(.+?)(?:[.!]|$)/i);
  if (prefer?.[1]) {
    personal.mergeProfile({
      communicationPrefs: [prefer[1].trim().slice(0, 80)],
      summary: personal.getProfile().summary || `Prefers: ${prefer[1].trim().slice(0, 100)}`,
    });
  }

  const always = t.match(/\bi always\s+(.+?)(?:[.!]|$)/i);
  if (always?.[1]) {
    personal.mergeProfile({ decisionPatterns: [`always ${always[1].trim().slice(0, 70)}`] });
  }

  const never = t.match(/\bi never\s+(.+?)(?:[.!]|$)/i);
  if (never?.[1]) {
    personal.mergeProfile({ decisionPatterns: [`never ${never[1].trim().slice(0, 70)}`] });
  }

  const think = t.match(/\bi (?:think|believe)\s+(.+?)(?:[.!]|$)/i);
  if (think?.[1] && think[1].trim().length > 12) {
    personal.mergeProfile({ ideationThemes: [think[1].trim().slice(0, 80)] });
  }

  const p = personal.getProfile();
  const bits = [
    p.communicationPrefs[0] ? `Wants ${p.communicationPrefs[0]}` : '',
    p.decisionPatterns[0] || '',
    p.ideationThemes[0] ? `Believes: ${p.ideationThemes[0]}` : '',
  ].filter(Boolean);
  if (bits.length >= 2) {
    personal.mergeProfile({ summary: bits.slice(0, 3).join('. ').slice(0, 280) });
  }
}

function shouldLearnNow(personal: PersonalStore, lastUser: string): boolean {
  if (!ENABLE_LEARN) return false;
  const profile = personal.getProfile();
  const userTurns = personal.state.conversation.filter((c) => c.role === 'user').length;
  const since = userTurns - (profile.turnsLearnedAt || 0);
  const force =
    /\b(i prefer|i always|i never|i think|i believe|my style|don't |do not |rather than)\b/i.test(
      lastUser,
    );
  if (force && lastUser.length >= 20) return true;
  if (since < LEARN_EVERY_N) return false;
  const recentUsers = personal.state.conversation
    .filter((c) => c.role === 'user')
    .slice(-LEARN_EVERY_N);
  return recentUsers.some((u) => u.content.replace(/\s+/g, ' ').trim().length >= 28);
}

export async function maybeLearnCeoThinking(
  personal: PersonalStore,
  lastUserText: string,
): Promise<boolean> {
  harvestExplicitPrefs(lastUserText, personal);

  if (!shouldLearnNow(personal, lastUserText)) {
    if (personal.getProfile().summary || personal.getProfile().thinkingStyle.length) {
      void personal.persist();
    }
    return false;
  }

  const turns = personal.state.conversation.slice(-12);
  const transcript = turns
    .map((t) => `${t.role === 'user' ? 'CEO' : 'VERN'}: ${t.content.slice(0, 320)}`)
    .join('\n');
  const prior = personal.formatThinkingProfile();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LEARN_TIMEOUT_MS);
  try {
    const completion = await tensorMuxChat({
      messages: [
        { role: 'system', content: LEARN_SYSTEM },
        {
          role: 'user',
          content: [
            prior ? `Prior profile:\n${prior}` : 'Prior profile: (empty)',
            `\nRecent chat:\n${transcript}`,
            `\nUpdate the profile from new evidence.`,
          ].join('\n'),
        },
      ],
      temperature: 0.2,
      maxTokens: 280,
      signal: ctrl.signal,
    });
    if (completion.model === 'deterministic-template') return false;
    const text = completion.choices[0]?.message.content?.trim() ?? '';
    const parsed = parseLearnJson(text);
    if (!parsed) return false;

    const userTurns = personal.state.conversation.filter((c) => c.role === 'user').length;
    personal.mergeProfile({
      ...parsed,
      turnsLearnedAt: userTurns,
    });
    const p = personal.getProfile();
    if (p.summary) personal.remember('thinking_profile', p.summary);
    await personal.persist();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
