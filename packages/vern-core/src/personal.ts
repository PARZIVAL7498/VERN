import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export interface MemoryFact {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface Reminder {
  id: string;
  text: string;
  when: string;
  done: boolean;
  createdAt: string;
}

/** Learned how the CEO thinks — updated quietly from conversation. */
export interface CeoThinkingProfile {
  summary: string;
  thinkingStyle: string[];
  priorities: string[];
  decisionPatterns: string[];
  ideationThemes: string[];
  communicationPrefs: string[];
  updatedAt: string;
  turnsLearnedAt: number;
}

export interface PersonalState {
  facts: MemoryFact[];
  notes: Note[];
  reminders: Reminder[];
  conversation: Array<{ role: 'user' | 'assistant'; content: string; at: string }>;
  thinking?: CeoThinkingProfile;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqMerge(existing: string[], incoming: string[], max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...incoming, ...existing]) {
    const t = raw.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function mergeThinkingProfile(
  current: CeoThinkingProfile,
  patch: Partial<CeoThinkingProfile>,
): CeoThinkingProfile {
  return {
    summary: (patch.summary?.trim() || current.summary).slice(0, 280),
    thinkingStyle: uniqMerge(current.thinkingStyle, patch.thinkingStyle ?? []),
    priorities: uniqMerge(current.priorities, patch.priorities ?? []),
    decisionPatterns: uniqMerge(current.decisionPatterns, patch.decisionPatterns ?? []),
    ideationThemes: uniqMerge(current.ideationThemes, patch.ideationThemes ?? []),
    communicationPrefs: uniqMerge(current.communicationPrefs, patch.communicationPrefs ?? []),
    updatedAt: new Date().toISOString(),
    turnsLearnedAt: patch.turnsLearnedAt ?? current.turnsLearnedAt,
  };
}

export function emptyThinkingProfile(): CeoThinkingProfile {
  return {
    summary: '',
    thinkingStyle: [],
    priorities: [],
    decisionPatterns: [],
    ideationThemes: [],
    communicationPrefs: [],
    updatedAt: new Date(0).toISOString(),
    turnsLearnedAt: 0,
  };
}

function emptyState(): PersonalState {
  return { facts: [], notes: [], reminders: [], conversation: [], thinking: emptyThinkingProfile() };
}

function normalizeThinking(raw: unknown): CeoThinkingProfile {
  const base = emptyThinkingProfile();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  const strArr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.slice(0, 80)) : [];
  return {
    summary: typeof o.summary === 'string' ? o.summary.slice(0, 280) : '',
    thinkingStyle: strArr(o.thinkingStyle),
    priorities: strArr(o.priorities),
    decisionPatterns: strArr(o.decisionPatterns),
    ideationThemes: strArr(o.ideationThemes),
    communicationPrefs: strArr(o.communicationPrefs),
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : base.updatedAt,
    turnsLearnedAt: typeof o.turnsLearnedAt === 'number' ? o.turnsLearnedAt : 0,
  };
}

function isPersonalState(value: unknown): value is PersonalState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.facts) &&
    Array.isArray(v.notes) &&
    Array.isArray(v.reminders) &&
    Array.isArray(v.conversation)
  );
}

export class PersonalStore {
  state: PersonalState = emptyState();
  private dataDir: string | undefined;

  constructor(options?: { dataDir?: string }) {
    this.dataDir = options?.dataDir ?? process.env.VERN_DATA_DIR;
  }

  seed(): void {
    const now = new Date().toISOString();
    this.state = {
      facts: [
        {
          id: uid('fact'),
          key: 'ceo_name',
          value: 'Sarvagya',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: uid('fact'),
          key: 'role',
          value: 'CEO',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: uid('fact'),
          key: 'company',
          value: 'Acme Corporation',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: uid('fact'),
          key: 'timezone',
          value: 'Asia/Kolkata',
          createdAt: now,
          updatedAt: now,
        },
      ],
      notes: [
        {
          id: uid('note'),
          title: 'Board focus',
          body: 'Cash discipline and AP fraud controls this close.',
          createdAt: now,
        },
      ],
      reminders: [
        {
          id: uid('rem'),
          text: 'Call the board about month-end exceptions',
          when: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
          done: false,
          createdAt: now,
        },
      ],
      conversation: [],
      thinking: emptyThinkingProfile(),
    };
  }

  getProfile(): CeoThinkingProfile {
    if (!this.state.thinking) this.state.thinking = emptyThinkingProfile();
    return this.state.thinking;
  }

  mergeProfile(patch: Partial<CeoThinkingProfile>): CeoThinkingProfile {
    const next = mergeThinkingProfile(this.getProfile(), patch);
    this.state.thinking = next;
    return next;
  }

  formatThinkingProfile(): string {
    const p = this.getProfile();
    if (!p.summary && !p.thinkingStyle.length && !p.priorities.length && !p.ideationThemes.length) {
      return '';
    }
    return [
      p.summary ? `Summary: ${p.summary}` : '',
      p.thinkingStyle.length ? `Thinking style: ${p.thinkingStyle.join('; ')}` : '',
      p.priorities.length ? `Priorities: ${p.priorities.join('; ')}` : '',
      p.decisionPatterns.length ? `Decision patterns: ${p.decisionPatterns.join('; ')}` : '',
      p.ideationThemes.length ? `Ideation themes: ${p.ideationThemes.join('; ')}` : '',
      p.communicationPrefs.length ? `Communication: ${p.communicationPrefs.join('; ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  remember(key: string, value: string): MemoryFact {
    const now = new Date().toISOString();
    const existing = this.state.facts.find((f) => f.key.toLowerCase() === key.toLowerCase());
    if (existing) {
      existing.value = value;
      existing.updatedAt = now;
      return existing;
    }
    const fact: MemoryFact = { id: uid('fact'), key, value, createdAt: now, updatedAt: now };
    this.state.facts.push(fact);
    return fact;
  }

  recall(query?: string): MemoryFact[] {
    if (!query?.trim()) {
      return this.state.facts.filter((f) => !f.key.startsWith('_'));
    }
    const q = query.toLowerCase();
    return this.state.facts.filter(
      (f) =>
        (f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q)) &&
        (!f.key.startsWith('_') || q.startsWith('_')),
    );
  }

  addNote(title: string, body: string): Note {
    const note: Note = { id: uid('note'), title, body, createdAt: new Date().toISOString() };
    this.state.notes.unshift(note);
    return note;
  }

  listNotes(): Note[] {
    return [...this.state.notes];
  }

  addReminder(text: string, whenIso?: string): Reminder {
    const rem: Reminder = {
      id: uid('rem'),
      text,
      when: whenIso || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      done: false,
      createdAt: new Date().toISOString(),
    };
    this.state.reminders.unshift(rem);
    return rem;
  }

  listReminders(includeDone = false): Reminder[] {
    return this.state.reminders.filter((r) => includeDone || !r.done);
  }

  completeReminder(id: string): Reminder | undefined {
    const r = this.state.reminders.find((x) => x.id === id);
    if (r) r.done = true;
    return r;
  }

  pushMessage(role: 'user' | 'assistant', content: string): void {
    this.state.conversation.push({ role, content, at: new Date().toISOString() });
    if (this.state.conversation.length > 80) {
      this.state.conversation = this.state.conversation.slice(-80);
    }
  }

  async persist(): Promise<string | null> {
    if (!this.dataDir) return null;
    await mkdir(this.dataDir, { recursive: true });
    const file = path.join(this.dataDir, 'personal-store.json');
    await writeFile(file, JSON.stringify(this.state, null, 2), 'utf8');
    return file;
  }

  async load(): Promise<boolean> {
    if (!this.dataDir) return false;
    try {
      const raw = await readFile(path.join(this.dataDir, 'personal-store.json'), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!isPersonalState(parsed)) return false;
      this.state = {
        ...parsed,
        thinking: normalizeThinking(parsed.thinking),
      };
      return true;
    } catch {
      return false;
    }
  }
}
