'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  tools?: string[];
  needsConfirm?: { action: string; detail: string };
};

type Briefing = {
  greeting: string;
  time: string;
  openReminders: Array<{ text: string; when: string }>;
};

const SUGGESTIONS = [
  'Good morning',
  'What do you know about me?',
  'Remind me to record the demo video',
  'Take a note: ship Track 2 judgment UX',
  'Draft a message to the team about the demo',
];

export default function JarvisPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    void fetch('/api/briefing')
      .then((r) => r.json())
      .then((b: Briefing) => setBrief(b))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  const speak = useCallback(
    (text: string) => {
      if (!speakReplies || typeof window === 'undefined' || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 600));
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    },
    [speakReplies],
  );

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const next = [...msgs, { role: 'user' as const, content: trimmed }];
    setMsgs(next);
    setInput('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        reply: string;
        toolCalls?: Array<{ name: string }>;
        needsConfirm?: { action: string; detail: string };
      };
      const assistant: Msg = {
        role: 'assistant',
        content: data.reply,
        tools: data.toolCalls?.map((t) => t.name),
        needsConfirm: data.needsConfirm,
      };
      setMsgs([...next, assistant]);
      speak(data.reply);
      void fetch('/api/briefing')
        .then((r) => r.json())
        .then((b: Briefing) => setBrief(b))
        .catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat failed');
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    const SR =
      typeof window !== 'undefined'
        ? (window as unknown as {
            SpeechRecognition?: new () => SpeechRecognitionLike;
            webkitSpeechRecognition?: new () => SpeechRecognitionLike;
          }).SpeechRecognition ||
          (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
            .webkitSpeechRecognition
        : undefined;

    if (!SR) {
      setError('Speech recognition not supported in this browser. Use Chrome, or type instead.');
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.onresult = (ev: SpeechRecognitionEventLike) => {
      const transcript = ev.results?.[0]?.[0]?.transcript;
      if (transcript) void send(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <div className="shell">
      <header>
        <h1 className="brand">
          <span className="orb" aria-hidden />
          JARVIS
        </h1>
        <p className="sub">Personal assistant — memory, notes, reminders, drafts. Confirm before anything sends.</p>
      </header>

      {brief && (
        <div className="brief">
          <strong>{brief.greeting}</strong>
          <span className="sub"> · {brief.time}</span>
          {brief.openReminders.length > 0 && (
            <p className="sub" style={{ marginTop: '0.5rem' }}>
              {brief.openReminders.length} open reminder
              {brief.openReminders.length === 1 ? '' : 's'} — try “list reminders”.
            </p>
          )}
        </div>
      )}

      <div className="chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => void send(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="chat" aria-live="polite">
        {msgs.length === 0 && (
          <div className="bubble assistant">
            <div className="meta">Jarvis</div>
            Online. Ask for a briefing, remind you of something, or remember a preference. Hold the mic
            for voice.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={`${m.role}-${i}`} className={`bubble ${m.role}`}>
            <div className="meta">{m.role === 'user' ? 'You' : 'Jarvis'}</div>
            {m.content}
            {m.tools && m.tools.length > 0 && (
              <div className="tools">Tools: {m.tools.join(', ')}</div>
            )}
            {m.needsConfirm && <div className="warn">{m.needsConfirm.detail}</div>}
          </div>
        ))}
        {busy && (
          <div className="bubble assistant">
            <div className="meta">Jarvis</div>
            Working…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="warn">{error}</p>}

      <div className="chips">
        <label className="chip" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={speakReplies}
            onChange={(e) => setSpeakReplies(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Speak replies
        </label>
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Jarvis…"
          disabled={busy}
          aria-label="Message"
        />
        <button
          type="button"
          className={`btn ghost mic ${listening ? 'active' : ''}`}
          onClick={toggleMic}
          aria-pressed={listening}
          title="Voice input"
        >
          {listening ? 'Listening' : 'Mic'}
        </button>
        <button type="submit" className="btn" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  results?: ArrayLike<ArrayLike<{ transcript?: string }>>;
}
