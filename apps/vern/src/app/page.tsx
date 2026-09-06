'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Criticality = 'Critical' | 'Watch' | 'OK';

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  criticality?: Criticality;
  tools?: string[];
  needsConfirm?: { action: string; detail: string };
};

type Briefing = {
  greeting: string;
  time: string;
  criticality: Criticality;
  openExceptions: number;
  openAmount: number;
  autoPosted: number;
  openReminders: Array<{ text: string; when: string }>;
};

type VoiceOption = { id: string; label: string };

const SUGGESTIONS = [
  "What's on fire?",
  'Morning briefing',
  'Explain the Northwind issue',
  'I prefer blunt risk-first answers',
  'How do I tend to think?',
];

const DEFAULT_VOICES: VoiceOption[] = [
  { id: 'en-US-GuyNeural', label: 'Guy · US (calm CFO)' },
  { id: 'en-GB-RyanNeural', label: 'Ryan · UK' },
  { id: 'en-US-ChristopherNeural', label: 'Christopher · US' },
  { id: 'en-IN-PrabhatNeural', label: 'Prabhat · India' },
  { id: 'en-US-JennyNeural', label: 'Jenny · US' },
  { id: 'en-IN-NeerjaNeural', label: 'Neerja · India' },
];

export default function VernPage() {
  const [mounted, setMounted] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [voices, setVoices] = useState<VoiceOption[]>(DEFAULT_VOICES);
  const [voiceId, setVoiceId] = useState('en-US-GuyNeural');
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const micHandledRef = useRef(false);
  const lastTranscriptRef = useRef('');
  const lastSendAtRef = useRef(0);
  const speakRepliesRef = useRef(speakReplies);
  const voiceIdRef = useRef(voiceId);
  const ttsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    speakRepliesRef.current = speakReplies;
  }, [speakReplies]);
  useEffect(() => {
    voiceIdRef.current = voiceId;
  }, [voiceId]);

  useEffect(() => {
    if (!mounted) return;
    const saved = localStorage.getItem('vern-voice');
    if (saved) setVoiceId(saved);
    void fetch('/api/tts')
      .then((r) => r.json())
      .then((d: { voices?: VoiceOption[]; defaultVoice?: string }) => {
        if (d.voices?.length) setVoices(d.voices);
        if (!saved && d.defaultVoice) setVoiceId(d.defaultVoice);
      })
      .catch(() => undefined);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    void fetch('/api/briefing')
      .then((r) => r.json())
      .then((b: Briefing) => setBrief(b))
      .catch(() => undefined);
  }, [mounted]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  useEffect(() => {
    return () => {
      ttsAbortRef.current?.abort();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioRef.current?.pause();
      recognitionRef.current?.abort?.();
      recognitionRef.current?.stop();
    };
  }, []);

  const stopSpeech = useCallback(() => {
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stopMic = useCallback(() => {
    try {
      recognitionRef.current?.abort?.();
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const speakBrowser = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 420));
    u.rate = 1.05;
    const pick = window.speechSynthesis
      .getVoices()
      .find((v) => /google|microsoft|neural|natural|enhanced/i.test(`${v.name} ${v.voiceURI}`));
    if (pick) u.voice = pick;
    window.speechSynthesis.speak(u);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!speakRepliesRef.current || typeof window === 'undefined') return;
      stopSpeech();
      const ac = new AbortController();
      ttsAbortRef.current = ac;
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: text.slice(0, 420), voice: voiceIdRef.current }),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        if (ac.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        await audio.play();
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        speakBrowser(text);
      }
    },
    [stopSpeech, speakBrowser],
  );

  const send = useCallback(
    async (text: string, opts?: { fromMic?: boolean }) => {
      let trimmed = text.replace(/\s+/g, ' ').trim();
      if (!trimmed) return;

      // Light client-side STT cleanup
      trimmed = trimmed
        .replace(/\bnorth\s*wind\b/gi, 'Northwind')
        .replace(/\bwhat(?:'s|s)?\s+on\s+fire\b/gi, "what's on fire");

      const now = Date.now();
      if (
        busyRef.current ||
        (trimmed.toLowerCase() === lastTranscriptRef.current.toLowerCase() &&
          now - lastSendAtRef.current < 2500)
      ) {
        return;
      }

      busyRef.current = true;
      lastTranscriptRef.current = trimmed;
      lastSendAtRef.current = now;
      setBusy(true);
      setError(null);
      stopMic();
      stopSpeech();

      setMsgs((prev) => [...prev, { role: 'user', content: trimmed }]);
      setInput('');

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: trimmed, source: opts?.fromMic ? 'mic' : 'text' }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as {
          reply: string;
          spoken?: string;
          criticality?: Criticality;
          toolCalls?: Array<{ name: string }>;
          needsConfirm?: { action: string; detail: string };
        };
        const assistant: Msg = {
          role: 'assistant',
          content: data.reply,
          criticality: data.criticality,
          tools: data.toolCalls?.map((t) => t.name),
          needsConfirm: data.needsConfirm,
        };
        setMsgs((prev) => [...prev, assistant]);
        void speak(data.spoken || data.reply);
        void fetch('/api/briefing')
          .then((r) => r.json())
          .then((b: Briefing) => setBrief(b))
          .catch(() => undefined);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Chat failed');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [speak, stopMic, stopSpeech],
  );

  function toggleMic() {
    const SR =
      typeof window !== 'undefined'
        ? (
            window as unknown as {
              SpeechRecognition?: new () => SpeechRecognitionLike;
              webkitSpeechRecognition?: new () => SpeechRecognitionLike;
            }
          ).SpeechRecognition ||
          (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
            .webkitSpeechRecognition
        : undefined;

    if (!SR) {
      setError('Speech recognition needs Chrome (or type instead).');
      return;
    }

    if (listening) {
      stopMic();
      return;
    }

    if (busyRef.current) return;

    micHandledRef.current = false;
    let finalBits = '';
    const rec = new SR();
    // en-US usually more accurate for mixed finance English; still works in India
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (ev: SpeechRecognitionEventLike) => {
      if (micHandledRef.current || busyRef.current) return;
      let interim = '';
      let finals = '';
      const results = ev.results;
      if (!results) return;
      for (let i = 0; i < results.length; i++) {
        const row = results[i];
        const piece = row?.[0]?.transcript?.trim() ?? '';
        if (!piece) continue;
        if (row && typeof row.isFinal === 'boolean') {
          if (row.isFinal) finals += (finals ? ' ' : '') + piece;
          else interim += (interim ? ' ' : '') + piece;
        } else {
          // Some browsers omit isFinal when continuous=false — treat as final
          finals += (finals ? ' ' : '') + piece;
        }
      }
      if (interim) setInput(interim);
      if (finals) {
        finalBits = `${finalBits} ${finals}`.replace(/\s+/g, ' ').trim();
        setInput(finalBits);
      }
      // Commit when we have a final chunk, or last result when event is complete enough
      const last = results[results.length - 1];
      const lastIsFinal = !last || typeof last.isFinal !== 'boolean' || last.isFinal;
      if (lastIsFinal && finalBits) {
        micHandledRef.current = true;
        const transcript = finalBits;
        stopMic();
        void send(transcript, { fromMic: true });
      }
    };
    rec.onerror = (ev?: { error?: string }) => {
      micHandledRef.current = true;
      setListening(false);
      recognitionRef.current = null;
      if (ev?.error && ev.error !== 'aborted' && ev.error !== 'no-speech') {
        setError(`Mic: ${ev.error}. Try again or type.`);
      }
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      // If we got text but never marked final, send what we heard
      if (!micHandledRef.current && finalBits && !busyRef.current) {
        micHandledRef.current = true;
        void send(finalBits, { fromMic: true });
      }
    };
    recognitionRef.current = rec;
    setListening(true);
    setInput('');
    setError(null);
    try {
      rec.start();
    } catch {
      setListening(false);
      setError('Mic busy — tap Mic once, wait a beat, then speak clearly.');
    }
  }

  return (
    <div className="shell">
      <header>
        <h1 className="brand">VERN</h1>
        <p className="sub">
          Personal CFO to the CEO - plain English, clear criticality, voice and text.
        </p>
      </header>

      {!mounted ? (
        <p className="sub">Starting VERN...</p>
      ) : (
        <>
          {brief && (
            <div className="brief">
              <span className={`crit ${brief.criticality}`}>{brief.criticality}</span>
              <div>
                <strong>{brief.greeting}</strong>
                <span className="sub"> · {brief.time}</span>
              </div>
              <p className="sub" style={{ margin: 0 }}>
                {brief.openExceptions} AP exceptions holding ~$
                {Math.round(brief.openAmount).toLocaleString('en-US')} · {brief.autoPosted}{' '}
                auto-posted
                {brief.openReminders.length
                  ? ` · ${brief.openReminders.length} personal reminder${brief.openReminders.length === 1 ? '' : 's'}`
                  : ''}
              </p>
            </div>
          )}

          <div className="chip-row">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => void send(s)}
                suppressHydrationWarning
              >
                {s}
              </button>
            ))}
          </div>

          <div className="chat" aria-live="polite">
            {msgs.length === 0 && (
              <div className="bubble assistant">
                <div className="meta">VERN · CFO</div>
                Online. Tap Mic, speak clearly, watch the box fill as it hears you - one reply at a
                time.
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={`${m.role}-${i}`} className={`bubble ${m.role}`}>
                <div className="meta">{m.role === 'user' ? 'You · CEO' : 'VERN · CFO'}</div>
                {m.criticality && <span className={`crit ${m.criticality}`}>{m.criticality}</span>}
                {m.content.replace(/^(Critical|Watch|OK)\s*/i, '').replace(/^\n+/, '')}
                {m.tools && m.tools.length > 0 && (
                  <div className="tools">Looked at: {m.tools.join(', ')}</div>
                )}
                {m.needsConfirm && <div className="warn">{m.needsConfirm.detail}</div>}
              </div>
            ))}
            {busy && (
              <div className="bubble assistant">
                <div className="meta">VERN · CFO</div>
                Checking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && <p className="warn">{error}</p>}

          <div className="chip-row voice-row">
            <label className={`chip ${speakReplies ? 'active' : ''}`} style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={speakReplies}
                onChange={(e) => setSpeakReplies(e.target.checked)}
                style={{ marginRight: 6 }}
                suppressHydrationWarning
              />
              Speak replies
            </label>
            <label className="voice-label">
              Voice
              <select
                className="voice-select"
                value={voiceId}
                onChange={(e) => {
                  setVoiceId(e.target.value);
                  localStorage.setItem('vern-voice', e.target.value);
                }}
                aria-label="TTS voice"
                suppressHydrationWarning
              >
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => void speak('This is VERN, your personal CFO.')}
              suppressHydrationWarning
            >
              Preview voice
            </button>
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
              placeholder={listening ? 'Listening… speak now' : 'Ask your CFO…'}
              disabled={busy}
              aria-label="Message"
              suppressHydrationWarning
            />
            <button
              type="button"
              className={`btn ghost mic ${listening ? 'active' : ''}`}
              onClick={toggleMic}
              disabled={busy}
              aria-pressed={listening}
              title="Voice input"
              suppressHydrationWarning
            >
              {listening ? 'Listening' : 'Mic'}
            </button>
            <button
              type="submit"
              className="btn"
              disabled={busy || !input.trim() || listening}
              suppressHydrationWarning
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

interface SpeechRecognitionEventLike {
  results?: ArrayLike<
    ArrayLike<{ transcript?: string }> & {
      isFinal?: boolean;
      length: number;
      0?: { transcript?: string };
    }
  > & { length: number };
}
