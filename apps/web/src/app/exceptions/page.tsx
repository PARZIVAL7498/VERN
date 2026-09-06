'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AssistPanel } from '@/components/assist/AssistPanel';
import {
  apiFetch,
  type JudgmentCard,
  type VernRole,
} from '@/lib/api';

const ROLES: VernRole[] = ['controller', 'ap_clerk', 'cfo', 'auditor'];

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function ExceptionsPage() {
  const [role, setRole] = useState<VernRole>('controller');
  const [cards, setCards] = useState<JudgmentCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sodHint, setSodHint] = useState<string | null>(null);
  const [learnFlash, setLearnFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<{ cards: JudgmentCard[] }>(`/v1/exceptions?role=${role}`, {
        role,
      });
      setCards(data.cards ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [role]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(card: JudgmentCard, action: 'approve' | 'reject') {
    setSodHint(null);
    setLearnFlash(null);

    if (role === 'auditor') {
      setSodHint('Auditors are read-only on the exception queue.');
      return;
    }
    if (action === 'approve' && card.sod.requiresCfo && role !== 'cfo') {
      setSodHint(card.sod.message);
      return;
    }
    if (action === 'approve' && card.sod.requiresController && role === 'ap_clerk') {
      setSodHint(card.sod.message);
      return;
    }

    const reason =
      action === 'approve'
        ? `Controller judgment: ${card.recommendedAction} — ${card.recommendationRationale.slice(0, 120)}`
        : `Rejected via review desk as ${role}`;

    setBusy(`${action}:${card.exceptionId}`);
    try {
      const res = await apiFetch<{ learned?: string[] }>(
        `/v1/exceptions/${card.exceptionId}/${action}`,
        {
          method: 'POST',
          role,
          body: JSON.stringify({
            userId:
              role === 'ap_clerk'
                ? 'user-ap'
                : role === 'cfo'
                  ? 'user-cfo'
                  : 'user-controller',
            reason,
          }),
        },
      );
      if (res.learned?.length) {
        setLearnFlash(res.learned.join(' · '));
      } else if (action === 'approve' && card.policyLearnPreview[0]) {
        setLearnFlash(card.policyLearnPreview.join(' · '));
      }
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Action failed';
      if (msg.includes('sod') || msg.includes('403')) {
        setSodHint(card.sod.message);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <h1 className="rise">Exception review desk</h1>
      <p className="lede rise-delay">
        Month-end AP judgment: each card shows risk, recommended action, SoD rules, and what policy
        will learn if you approve — not just a confidence score.
      </p>

      <div className="toolbar">
        <label>
          Acting as{' '}
          <select
            className="select"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as VernRole);
              setSodHint(null);
            }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {sodHint && (
        <div className="callout warn rise" role="status">
          <strong>SoD</strong> — {sodHint}
        </div>
      )}
      {learnFlash && (
        <div className="callout ok rise" role="status">
          <strong>Policy learn</strong> — {learnFlash}
        </div>
      )}
      {error && <p className="muted">{error}</p>}

      <div className="judgment-grid">
        {cards.map((card) => (
          <article key={`${card.exceptionId}:${card.invoiceId}`} className="judgment-card rise">
            <header className="judgment-head">
              <span className={`badge ${card.severity === 'critical' ? 'critical' : ''}`}>
                {card.severity}
              </span>
              <span className="muted">{card.riskSummary}</span>
            </header>
            <h2 className="judgment-title">
              <Link href={`/invoices/${card.invoiceId}`}>{card.invoiceNumber}</Link>
              <span className="muted"> · {card.vendorName}</span>
            </h2>
            <p className="judgment-amount">{money(card.amount, card.currency)}</p>

            <div className="chip-row">
              {card.fraudChips.map((c) => (
                <span key={c} className="chip fraud">
                  {c}
                </span>
              ))}
              {card.guardrailChips.slice(0, 3).map((c) => (
                <span key={c} className="chip guard">
                  {c.length > 48 ? `${c.slice(0, 48)}…` : c}
                </span>
              ))}
            </div>

            <div className="recommend">
              <div className="label">Recommended</div>
              <strong className="rec-action">{card.recommendedAction.replace('_', ' ')}</strong>
              <p>{card.recommendationRationale}</p>
            </div>

            <div className="learn-preview">
              <div className="label">If you approve — policy learn preview</div>
              <ul className="list">
                {card.policyLearnPreview.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>

            <p className="sod-line muted">{card.sod.message}</p>

            <div className="toolbar" style={{ marginBottom: 0 }}>
              <button
                type="button"
                className="btn"
                disabled={busy !== null || role === 'auditor'}
                onClick={() => void act(card, 'approve')}
              >
                {busy === `approve:${card.exceptionId}` ? '…' : 'Approve & post'}
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={busy !== null || role === 'auditor'}
                onClick={() => void act(card, 'reject')}
              >
                Reject
              </button>
              <Link className="btn secondary" href={`/invoices/${card.invoiceId}`}>
                Explain
              </Link>
            </div>
          </article>
        ))}
        {cards.length === 0 && (
          <p className="muted">Queue clear for this role filter — switch role or refresh.</p>
        )}
      </div>

      <AssistPanel role={role} onRoleHint={setSodHint} />
    </main>
  );
}
