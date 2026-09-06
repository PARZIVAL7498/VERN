import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

export interface JarvisState {
  facts: MemoryFact[];
  notes: Note[];
  reminders: Reminder[];
  conversation: Array<{ role: 'user' | 'assistant'; content: string; at: string }>;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class JarvisStore {
  state: JarvisState = { facts: [], notes: [], reminders: [], conversation: [] };
  private dataDir?: string;

  constructor(options?: { dataDir?: string }) {
    this.dataDir = options?.dataDir ?? process.env.JARVIS_DATA_DIR;
  }

  seed(): void {
    const now = new Date().toISOString();
    this.state = {
      facts: [
        {
          id: uid('fact'),
          key: 'user_name',
          value: 'Sarvagya',
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
        {
          id: uid('fact'),
          key: 'focus_project',
          value: 'VERN Track 2 hackathon — Office of the CFO',
          createdAt: now,
          updatedAt: now,
        },
      ],
      notes: [
        {
          id: uid('note'),
          title: 'Hackathon demo',
          body: 'Show AP exception desk, SoD, policy learn, Assist. Record AO sessions.',
          createdAt: now,
        },
      ],
      reminders: [
        {
          id: uid('rem'),
          text: 'Record Syndicate demo video (product + AO)',
          when: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          done: false,
          createdAt: now,
        },
      ],
      conversation: [],
    };
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
    if (!query?.trim()) return [...this.state.facts];
    const q = query.toLowerCase();
    return this.state.facts.filter(
      (f) => f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q),
    );
  }

  addNote(title: string, body: string): Note {
    const note: Note = {
      id: uid('note'),
      title,
      body,
      createdAt: new Date().toISOString(),
    };
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
    this.state.conversation.push({
      role,
      content,
      at: new Date().toISOString(),
    });
    if (this.state.conversation.length > 80) {
      this.state.conversation = this.state.conversation.slice(-80);
    }
  }

  briefing(): {
    greeting: string;
    time: string;
    facts: MemoryFact[];
    openReminders: Reminder[];
    recentNotes: Note[];
  } {
    const name = this.recall('user_name')[0]?.value ?? 'there';
    const now = new Date();
    const hour = now.getHours();
    const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    return {
      greeting: `Good ${part}, ${name}.`,
      time: now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      facts: this.state.facts.slice(0, 8),
      openReminders: this.listReminders(),
      recentNotes: this.state.notes.slice(0, 3),
    };
  }

  async persist(): Promise<string | null> {
    if (!this.dataDir) return null;
    await mkdir(this.dataDir, { recursive: true });
    const file = path.join(this.dataDir, 'jarvis-store.json');
    await writeFile(file, JSON.stringify(this.state, null, 2), 'utf8');
    return file;
  }

  async load(): Promise<boolean> {
    if (!this.dataDir) return false;
    try {
      const raw = await readFile(path.join(this.dataDir, 'jarvis-store.json'), 'utf8');
      this.state = JSON.parse(raw) as JarvisState;
      return true;
    } catch {
      return false;
    }
  }
}
