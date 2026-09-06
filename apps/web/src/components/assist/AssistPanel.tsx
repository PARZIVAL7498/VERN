'use client';

import { useState } from 'react';
import { apiFetch, type VernRole } from '@/lib/api';

const PROMPTS = [
  "What's blocking close?",
  'Explain the Northwind bank-change invoice',
  'Show close checklist and cash',
  'Approve the just-under exception as controller',
];

type Msg = { role: 'user' | 'assistant'; content: string };

export function AssistPanel({
  role,
  onRoleHint,
}: {
  role: VernRole;
  onRoleHint?: (msg: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setErr(null);
    onRoleHint?.(null);
    const next = [...msgs, { role: 'user' as const, content: trimmed }];
    setMsgs(next);
    setInput('');
    try {
      const res = await apiFetch<{ reply: string; toolCalls: unknown[] }>('/v1/assistant/chat', {
        method: 'POST',
        role,
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      setMsgs([...next, { role: 'assistant', content: res.reply }]);
      if (/sod|clerk|cannot/i.test(res.reply)) {
        onRoleHint?.(res.reply.slice(0, 200));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Assist failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`assist ${open ? 'open' : ''}`}>
      <button type="button" className="assist-toggle btn" onClick={() => setOpen((o) => !o)}>
        {open ? 'Close Assist' : 'Assist'}
      </button>
      {open && (
        <div className="assist-panel rise" role="dialog" aria-label="VERN Assist">
          <header>
            <strong>VERN Assist</strong>
            <span className="muted"> as {role} · month-end AP radio</span>
          </header>
          <p className="muted assist-lede">
            Ask what is blocking close, explain an invoice, or approve with the same SoD as the desk.
          </p>
          <div className="assist-chips">
            {PROMPTS.map((p) => (
              <button key={p} type="button" className="chip-btn" onClick={() => void send(p)}>
                {p}
              </button>
            ))}
          </div>
          <div className="assist-log">
            {msgs.map((m, i) => (
              <div key={`${m.role}-${i}`} className={`assist-msg ${m.role}`}>
                <div className="label">{m.role === 'user' ? 'You' : 'VERN'}</div>
                <pre>{m.content}</pre>
              </div>
            ))}
            {msgs.length === 0 && (
              <p className="muted">No messages yet — try “What’s blocking close?”</p>
            )}
          </div>
          {err && <p className="muted">{err}</p>}
          <form
            className="assist-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input
              className="assist-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the close desk…"
              disabled={busy}
            />
            <button type="submit" className="btn" disabled={busy}>
              {busy ? '…' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
