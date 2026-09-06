import { tensorMuxChat } from './agent.js';
import { buildCashSnapshot, buildCloseChecklist } from './close.js';
import { cfoDashboardRollup } from './analytics.js';
import { buildJudgmentCard } from './judgment.js';
import { harvestExplicitPrefs, maybeLearnCeoThinking } from './ceo-learn.js';
import type { PersonalStore } from './personal.js';
import type { Store } from './store.js';
import process from 'node:process';

export type Criticality = 'Critical' | 'Watch' | 'OK';

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface VernCfoChatResult {
  reply: string;
  spoken: string;
  criticality: Criticality;
  toolCalls: ToolCallRecord[];
  needsConfirm?: { action: string; detail: string };
}

type ToolName =
  | 'small_talk'
  | 'get_company_briefing'
  | 'list_exceptions_plain'
  | 'explain_invoice_plain'
  | 'get_cash_and_close'
  | 'get_cfo_rollup'
  | 'remember'
  | 'recall'
  | 'add_note'
  | 'list_notes'
  | 'add_reminder'
  | 'list_reminders'
  | 'draft_message'
  | 'get_time';

const TOOLS: ToolName[] = [
  'small_talk',
  'get_company_briefing',
  'list_exceptions_plain',
  'explain_invoice_plain',
  'get_cash_and_close',
  'get_cfo_rollup',
  'remember',
  'recall',
  'add_note',
  'list_notes',
  'add_reminder',
  'list_reminders',
  'draft_message',
  'get_time',
];

function moneyWords(n: number): string {
  if (n >= 1_000_000) return `about $${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `~$${Math.round(n).toLocaleString('en-US')}`;
  return `$${Math.round(n)}`;
}

function shortPlainException(card: {
  vendorName: string;
  amount: number;
  riskSummary: string;
  recommendedAction: string;
}): string {
  let risk = card.riskSummary.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  // Drop leading money noise already covered by moneyWords()
  risk = risk.replace(/^USD\s*[\d,]+\s*/i, '').replace(/^\$[\d,.]+\s*/i, '').trim();
  if (risk.length > 72) risk = `${risk.slice(0, 72)}...`;
  const action = card.recommendedAction.replace(/_/g, ' ');
  return `${card.vendorName} (${moneyWords(card.amount)}): ${risk || action}`;
}

function criticalityFromExceptions(store: Store): Criticality {
  const open = store.exceptions.filter((e) => e.status === 'open' || e.status === 'in_review');
  const text = open.map((e) => e.reasons.join(' ')).join(' ').toLowerCase();
  if (text.includes('blocked') || text.includes('bank')) return 'Critical';
  if (open.length > 0) return 'Watch';
  return 'OK';
}

function guessInvoiceId(q: string, store: Store): string {
  if (q.includes('northwind') || q.includes('bank')) {
    return store.invoices.find((i) => i.id === 'inv-bankChange')?.id ?? 'inv-bankChange';
  }
  if (q.includes('shadow') || q.includes('blocked')) {
    return store.invoices.find((i) => i.id === 'inv-blockedVendor')?.id ?? 'inv-blockedVendor';
  }
  if (q.includes('duplicate')) return 'inv-duplicate';
  if (q.includes('under') || q.includes('just')) return 'inv-justUnder';
  if (q.includes('auto')) return 'inv-autoPost';
  const open = store.exceptions.find((e) => e.status === 'open' || e.status === 'in_review');
  return open?.invoiceId ?? store.invoices[0]?.id ?? '';
}

function runTool(
  name: ToolName,
  args: Record<string, unknown>,
  company: Store,
  personal: PersonalStore,
): unknown {
  switch (name) {
    case 'get_time':
      return {
        local: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      };
    case 'small_talk': {
      const name = personal.recall('ceo_name')[0]?.value ?? 'there';
      const open = company.exceptions.filter((e) => e.status === 'open' || e.status === 'in_review');
      const level = criticalityFromExceptions(company);
      return {
        name,
        userSaid: String(args.text ?? ''),
        openExceptions: open.length,
        hasPressure: level !== 'OK',
        timeOfDay: hourPart(),
      };
    }
    case 'get_company_briefing': {
      const open = company.exceptions.filter((e) => e.status === 'open' || e.status === 'in_review');
      const rollup = cfoDashboardRollup(company.invoices, company.exceptions, company.audits);
      const cash = buildCashSnapshot(company.invoices, company.exceptions);
      const name = personal.recall('ceo_name')[0]?.value ?? 'boss';
      return {
        greeting: `Good ${hourPart()}, ${name}`,
        criticality: criticalityFromExceptions(company),
        openExceptions: open.length,
        openAmount: cash.openExceptionsAmount,
        autoPosted: rollup.autoPostedCount,
        topReasons: rollup.topExceptionReasons.slice(0, 3),
        reminders: personal.listReminders().slice(0, 3),
        facts: personal.recall().slice(0, 5),
      };
    }
    case 'list_exceptions_plain': {
      const open = company.exceptions.filter((e) => e.status === 'open' || e.status === 'in_review');
      if (!company.rules) return [];
      const filterCritical = String(args.filter ?? '') === 'critical';
      const cards = open.map((e) => {
        const inv = company.invoices.find((i) => i.id === e.invoiceId);
        if (!inv || !company.rules) {
          return { invoiceId: e.invoiceId, reasons: e.reasons, plain: e.reasons.join('; '), criticality: 'Watch' as const, rank: 1 };
        }
        const card = buildJudgmentCard({ exception: e, invoice: inv, rules: company.rules });
        const criticality =
          card.recommendedAction === 'escalate_cfo' ? ('Critical' as const) : ('Watch' as const);
        return {
          invoiceNumber: card.invoiceNumber,
          vendorName: card.vendorName,
          amount: card.amount,
          criticality,
          plain: shortPlainException(card),
          recommendedAction: card.recommendedAction,
          rank: criticality === 'Critical' ? 0 : 1,
        };
      });
      const sorted = cards.sort((a, b) => a.rank - b.rank);
      const filtered = filterCritical ? sorted.filter((c) => c.criticality === 'Critical') : sorted;
      return (filtered.length ? filtered : sorted).slice(0, 3);
    }
    case 'explain_invoice_plain': {
      const id = String(args.invoiceId ?? '');
      const inv = company.invoices.find((i) => i.id === id || i.invoiceNumber === id);
      if (!inv) return { error: 'not_found' };
      const ex = company.exceptions.find((e) => e.invoiceId === inv.id);
      const card =
        ex && company.rules
          ? buildJudgmentCard({ exception: ex, invoice: inv, rules: company.rules })
          : null;
      return {
        invoiceNumber: inv.invoiceNumber,
        vendorName: inv.vendorName,
        amount: inv.totalAmount,
        status: inv.status,
        plain: card
          ? `${inv.invoiceNumber}: ${shortPlainException(card)}`
          : `${inv.vendorName} ${inv.invoiceNumber} is ${inv.status} (${moneyWords(inv.totalAmount)}).`,
        criticality: card?.recommendedAction === 'escalate_cfo' ? 'Critical' : ex ? 'Watch' : 'OK',
      };
    }
    case 'get_cash_and_close': {
      const cash = buildCashSnapshot(company.invoices, company.exceptions);
      const checklist = buildCloseChecklist(company.invoices, company.exceptions);
      const blocked = checklist.filter((c) => c.status !== 'done');
      return {
        cash,
        criticality: blocked.some((c) => c.status === 'blocked')
          ? 'Critical'
          : blocked.length
            ? 'Watch'
            : 'OK',
        plain: `7d cash out ${moneyWords(cash.projectedCashOut7d)}; stuck in exceptions ${moneyWords(cash.openExceptionsAmount)}. Open: ${blocked.map((b) => b.label).join('; ') || 'none'}.`,
      };
    }
    case 'get_cfo_rollup': {
      const r = cfoDashboardRollup(company.invoices, company.exceptions, company.audits);
      return {
        openExceptions: r.openExceptions,
        autoPostedCount: r.autoPostedCount,
        totalSpend: r.totalSpend,
        topReason: r.topExceptionReasons[0]?.reason ?? 'none',
        criticality: r.criticalExceptions > 0 || r.openExceptions > 3 ? 'Critical' : r.openExceptions ? 'Watch' : 'OK',
        plain: `${r.openExceptions} open exceptions on ${moneyWords(r.totalSpend)} spend; ${r.autoPostedCount} auto-posted. Top issue: ${r.topExceptionReasons[0]?.reason ?? 'none'}.`,
      };
    }
    case 'remember':
      return personal.remember(String(args.key ?? 'memory'), String(args.value ?? ''));
    case 'recall': {
      const q = args.query ? String(args.query) : undefined;
      const facts = personal.recall(q);
      const thinking = personal.formatThinkingProfile();
      const wantsThinking =
        !q ||
        /think|learn|style|ideat|prefer|know about me|who am i/i.test(q);
      return {
        facts,
        thinking: wantsThinking ? thinking : '',
        plain: [
          thinking && wantsThinking ? `How you think:\n${thinking}` : '',
          facts.length
            ? `Facts: ${facts
                .slice(0, 6)
                .map((f) => `${f.key}=${f.value}`)
                .join('; ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n\n') || '(nothing stored yet)',
      };
    }
    case 'add_note':
      return personal.addNote(String(args.title ?? 'Note'), String(args.body ?? args.text ?? ''));
    case 'list_notes':
      return personal.listNotes();
    case 'add_reminder':
      return personal.addReminder(
        String(args.text ?? args.title ?? 'Reminder'),
        args.when ? String(args.when) : undefined,
      );
    case 'list_reminders':
      return personal.listReminders(Boolean(args.includeDone));
    case 'draft_message':
      return {
        draft: true,
        to: String(args.to ?? 'team'),
        subject: String(args.subject ?? 'Note from VERN'),
        body: String(args.body ?? ''),
        warning: 'Draft only - I will not send this unless you confirm outside chat.',
      };
    default:
      return { error: 'unknown_tool' };
  }
}

function hourPart(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

/** Normalize CEO typed/spoken input (STT noise + casual phrasing). */
export function normalizeCeoInput(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  const swaps: Array<[RegExp, string]> = [
    [/\bnorth\s*wind\b/gi, 'Northwind'],
    [/\bnorthwind\b/gi, 'Northwind'],
    [/\bshadow logistics\b/gi, 'Shadow Logistics'],
    [/\bwhat(?:'s| is|s)?\s+on\s+fire\b/gi, "what's on fire"],
    [/\bwhat(?:'s| is|s)?\s+blocking\b/gi, "what's blocking"],
    [/\bgood\s+morning\b/gi, 'good morning'],
    [/\bmorning briefing\b/gi, 'morning briefing'],
    [/\bremind me to\b/gi, 'remind me to'],
    [/\bcall the board\b/gi, 'call the board'],
    [/\bexceptions?\b/gi, 'exception'],
  ];
  for (const [re, to] of swaps) t = t.replace(re, to);
  return t.trim();
}

export function routeVernIntent(
  text: string,
  ctx?: { lastTool?: string; lastAssistant?: string },
): { tool: ToolName; args: Record<string, unknown> } {
  const q = normalizeCeoInput(text).toLowerCase();

  // Explicit personal / utility intents first
  if (q.includes('remember') || q.includes('my name is') || q.includes('i prefer')) {
    const nameMatch = text.match(/my name is\s+([^,.]+)/i);
    if (nameMatch?.[1]) return { tool: 'remember', args: { key: 'ceo_name', value: nameMatch[1].trim() } };
    const rem = text.match(/remember (?:that )?(.+)/i);
    if (rem?.[1]) return { tool: 'remember', args: { key: 'memory', value: rem[1].trim() } };
    return { tool: 'remember', args: { key: 'memory', value: text } };
  }
  // Declarative beliefs / style — learn ideation, don't treat as a finance query
  if (
    !/\?/.test(q) &&
    /\bi (think|believe|always|never)\b/.test(q) &&
    !/\b(briefing|exception|invoice|show me|what's on)\b/.test(q)
  ) {
    return { tool: 'remember', args: { key: 'ideation', value: text } };
  }
  if (
    q.includes('what do you know') ||
    q.includes('recall') ||
    q.includes('who am i') ||
    q.includes('what have you learned') ||
    q.includes('my thinking') ||
    q.includes('thinking style') ||
    q.includes('about how i') ||
    /\bhow (do|does) i\b.*\bthink\b/.test(q) ||
    /\bhow i (tend to )?think\b/.test(q) ||
    /\blearned about me\b/.test(q)
  ) {
    return { tool: 'recall', args: { query: text } };
  }
  if (q.includes('remind me') || q.includes('add reminder')) {
    const cleaned = text.replace(/remind me to\s*/i, '').replace(/add reminder\s*/i, '').trim();
    return { tool: 'add_reminder', args: { text: cleaned || text } };
  }
  if (q.includes('list reminder') || q.includes('my reminders')) {
    return { tool: 'list_reminders', args: {} };
  }
  if (/\b(take a note|add note|note that|write down)\b/.test(q)) {
    const body = text.replace(/^(take a note|add note|note that|write down)[:\s]*/i, '').trim();
    return { tool: 'add_note', args: { title: 'CEO note', body: body || text } };
  }
  if (q.includes('list notes') || q.includes('my notes')) {
    return { tool: 'list_notes', args: {} };
  }
  if (/\bdraft\b/.test(q)) {
    return {
      tool: 'draft_message',
      args: {
        body: text.replace(/draft (an? )?(email|message|msg)\s*/i, '').trim() || text,
        subject: 'Draft from VERN',
      },
    };
  }
  if (/\b(what )?time\b/.test(q) || /\bwhat date\b/.test(q)) {
    return { tool: 'get_time', args: {} };
  }

  // Exception / critical follow-ups (must beat generic "morning" defaults)
  const wantsCritical =
    /\bcritical\b/.test(q) ||
    /\bon fire\b/.test(q) ||
    /\burgent\b/.test(q) ||
    /\bescalate\b/.test(q) ||
    /\bbank[- ]?change\b/.test(q) ||
    /\bblocked\b/.test(q);
  const wantsCases =
    wantsCritical ||
    /\b(exception|queue|risk|fraud|vendor cases?|ap items?)\b/.test(q) ||
    /\b(show|list|give|walk|open|pull)\b.*\b(case|cases|them|those|it|exceptions?)\b/.test(q) ||
    /\b(case|cases|them|those)\b.*\b(first|now|please)\b/.test(q) ||
    /\bshow me\b/.test(q) ||
    /\bwhat('?s| is) (blocking|wrong|flagged|stuck)\b/.test(q);

  if (wantsCases) {
    return {
      tool: 'list_exceptions_plain',
      args: wantsCritical ? { filter: 'critical' } : {},
    };
  }

  if (
    q.includes('explain') ||
    q.includes('northwind') ||
    q.includes('shadow') ||
    (q.includes('why') && (q.includes('invoice') || q.includes('vendor') || q.includes('bank')))
  ) {
    return { tool: 'explain_invoice_plain', args: { invoiceId: '' } };
  }

  if (q.includes('cash') || q.includes('close pack') || q.includes('checklist') || q.includes('variance')) {
    return { tool: 'get_cash_and_close', args: {} };
  }
  if (q.includes('close') && !q.includes('closing remark')) {
    return { tool: 'get_cash_and_close', args: {} };
  }
  if (q.includes('dashboard') || q.includes('rollup') || q.includes('spend')) {
    return { tool: 'get_cfo_rollup', args: {} };
  }

  // Conversational follow-up: "those", "the first ones", "go ahead" after a briefing
  const followUp =
    /^(ok|okay|yes|yeah|yep|sure|please|go ahead|do it)\b/.test(q) ||
    /\b(those|them|the first|that list|same)\b/.test(q);
  if (followUp && (ctx?.lastTool === 'get_company_briefing' || /critical|exception|bank|blocked/i.test(ctx?.lastAssistant ?? ''))) {
    return { tool: 'list_exceptions_plain', args: { filter: 'critical' } };
  }

  // Casual chat / greetings - personal chatbot, not a briefing dump
  if (
    /^(hi|hello|hey|yo|sup)\b/.test(q) ||
    /\bhow are (you|u)\b/.test(q) ||
    /\bhow('?s| is) it going\b/.test(q) ||
    /\bwhat'?s going on\b/.test(q) ||
    /\bnice to (meet|see) you\b/.test(q) ||
    (/\bgood (morning|afternoon|evening)\b/.test(q) && !/\bbrief/.test(q)) ||
    /\bhi everyone\b/.test(q) ||
    /\bthanks?\b/.test(q) ||
    /\bthank you\b/.test(q) ||
    /\bbye\b/.test(q) ||
    /\bsee you\b/.test(q)
  ) {
    if (!/\bbrief(ing)?\b/.test(q) && !/\bon fire\b/.test(q) && !/\bstatus\b/.test(q)) {
      return { tool: 'small_talk', args: { text } };
    }
  }

  // Briefing only when clearly asked
  if (
    /\bbrief(ing)?\b/.test(q) ||
    /\bstatus( update)?\b/.test(q) ||
    /\bpulse\b/.test(q) ||
    /\bcatch me up\b/.test(q) ||
    /\bwhere do we stand\b/.test(q)
  ) {
    return { tool: 'get_company_briefing', args: {} };
  }
  // Unknown: prefer exceptions over repeating briefing
  return { tool: 'list_exceptions_plain', args: {} };
}

function shapeReply(
  tool: ToolName,
  result: unknown,
  fallbackCriticality: Criticality,
): { reply: string; criticality: Criticality } {
  let criticality = fallbackCriticality;

  if (tool === 'small_talk' && result && typeof result === 'object') {
    const b = result as {
      name: string;
      userSaid: string;
      openExceptions: number;
      hasPressure: boolean;
      timeOfDay: string;
    };
    const q = b.userSaid.toLowerCase();
    const askingHow =
      /\bhow are (you|u)\b/.test(q) || /\bhow('?s| is) it going\b/.test(q);
    const thanks = /\bthanks?\b/.test(q) || /\bthank you\b/.test(q);
    const bye = /\bbye\b/.test(q) || /\bsee you\b/.test(q);

    if (thanks) {
      return {
        criticality: 'OK',
        reply: `OK\n\nAnytime, ${b.name}. I've got your back on the numbers.\n\nPing me when you want the briefing or the Critical cases.`,
      };
    }
    if (bye) {
      return {
        criticality: 'OK',
        reply: `OK\n\nCatch you later, ${b.name}. I'll keep an eye on AP while you're out.`,
      };
    }

    let opener = `Hey ${b.name} - good ${b.timeOfDay}.`;
    if (askingHow) {
      opener = `Hey ${b.name} - I'm good, thanks for asking. Sharp and ready.`;
    } else if (/^(hi|hello|hey)/.test(q)) {
      opener = `Hey ${b.name} - good to hear from you.`;
    }

    if (b.hasPressure) {
      return {
        criticality: 'OK',
        reply: `OK\n\n${opener} Whenever you're ready I can walk the books - there are a few AP items that need a human look, but we don't have to dive in unless you want.\n\nJust say "what's on fire?" or "morning briefing" when you do.`,
      };
    }
    return {
      criticality: 'OK',
      reply: `OK\n\n${opener} Things look pretty calm on my side.\n\nAsk for a briefing anytime, or just tell me what you need.`,
    };
  }

  if (tool === 'get_company_briefing' && result && typeof result === 'object') {
    const b = result as {
      greeting: string;
      criticality: Criticality;
      openExceptions: number;
      openAmount: number;
      autoPosted: number;
      reminders: Array<{ text: string }>;
    };
    criticality = b.criticality;
    const rem = b.reminders[0] ? ` Also on your list: ${b.reminders[0].text}.` : '';
    if (criticality === 'OK') {
      return {
        criticality,
        reply: `${criticality}\n\n${b.greeting}. Books look calm - ${b.autoPosted} invoices already cleared cleanly.${rem}\n\nI'd recommend a quick cash glance, then you're free to focus elsewhere.`,
      };
    }
    return {
      criticality,
      reply: `${criticality}\n\n${b.greeting}. We've got ${b.openExceptions} AP items still open, about ${moneyWords(b.openAmount)} tied up.${rem}\n\nI'd recommend we hit the Critical cases first - bank changes and blocked vendors - before anyone posts them.`,
    };
  }

  if (tool === 'list_exceptions_plain' && Array.isArray(result)) {
    if (result.length === 0) {
      return {
        criticality: 'OK',
        reply: `OK\n\nGood news - the exception queue is empty right now.\n\nI'd recommend we peek at cash next only if you want peace of mind.`,
      };
    }
    const items = result as Array<{ plain: string; criticality?: Criticality; vendorName?: string }>;
    criticality = items.some((i) => i.criticality === 'Critical') ? 'Critical' : 'Watch';
    const top = items.slice(0, 2);
    const spokenList = top.map((i) => i.plain).join('. ');
    const extra =
      items.length > 2 ? ` There are ${items.length - 2} more waiting after that.` : '';
    return {
      criticality,
      reply: `${criticality}\n\nHere are the Critical ones first: ${spokenList}.${extra}\n\nI'd recommend you take these yourself - clerks should not clear bank-fraud or blocked-vendor payments.`,
    };
  }

  if (tool === 'explain_invoice_plain' && result && typeof result === 'object') {
    const r = result as { plain?: string; criticality?: Criticality; error?: string };
    if (r.error) {
      return {
        criticality: 'Watch',
        reply: `Watch\n\nI couldn't find that invoice in the books.\n\nI'd recommend asking "what's on fire?" and I'll walk the open cases with you.`,
      };
    }
    criticality = (r.criticality as Criticality) || 'Watch';
    return {
      criticality,
      reply: `${criticality}\n\n${r.plain}\n\nI'd recommend we escalate if it's a bank change or blocked vendor - don't rubber-stamp it.`,
    };
  }

  if (tool === 'get_cash_and_close' && result && typeof result === 'object') {
    const r = result as { plain: string; criticality: Criticality };
    criticality = r.criticality;
    return {
      criticality,
      reply: `${criticality}\n\n${r.plain}\n\nI'd recommend clearing anything blocked on the checklist before you tell the board close is clean.`,
    };
  }

  if (tool === 'get_cfo_rollup' && result && typeof result === 'object') {
    const r = result as { plain: string; criticality: Criticality };
    criticality = r.criticality;
    return {
      criticality,
      reply: `${criticality}\n\n${r.plain}\n\nI'd recommend we dig into that top exception reason next.`,
    };
  }

  if (tool === 'remember' && result && typeof result === 'object') {
    const f = result as { key: string; value: string };
    return {
      criticality: 'OK',
      reply: `OK\n\nGot it - I'll keep ${f.key} as "${f.value}".\n\nAsk me anytime if you want me to recall it.`,
    };
  }

  if (tool === 'recall' && result && typeof result === 'object' && !Array.isArray(result)) {
    const r = result as { plain?: string; facts?: Array<{ key: string; value: string }>; thinking?: string };
    if (!r.plain || r.plain === '(nothing stored yet)') {
      return {
        criticality: 'OK',
        reply: `OK\n\nI'm still learning how you think - keep chatting and I'll pick up your style.\n\nYou can also say "remember that..." or "I prefer..." anytime.`,
      };
    }
    return {
      criticality: 'OK',
      reply: `OK\n\n${r.plain}\n\nI'll keep adapting as we talk.`,
    };
  }

  if (tool === 'recall' && Array.isArray(result)) {
    if (!result.length) {
      return {
        criticality: 'OK',
        reply: `OK\n\nI don't have anything stored on that yet.\n\nJust say "remember that..." and I'll lock it in.`,
      };
    }
    const lines = result
      .slice(0, 4)
      .map((f: { key: string; value: string }) => `${f.key}: ${f.value}`)
      .join('; ');
    return {
      criticality: 'OK',
      reply: `OK\n\nHere's what I've got on you: ${lines}.`,
    };
  }

  if (tool === 'add_reminder' && result && typeof result === 'object') {
    const r = result as { text: string; when: string };
    return {
      criticality: 'OK',
      reply: `OK\n\nDone - I'll nudge you about "${r.text}" around ${new Date(r.when).toLocaleString('en-IN')}.`,
    };
  }

  if (tool === 'list_reminders' && Array.isArray(result)) {
    if (!result.length) return { criticality: 'OK', reply: `OK\n\nYou're clear - no open reminders.` };
    const lines = result
      .slice(0, 4)
      .map((r: { text: string }) => r.text)
      .join('; ');
    return { criticality: 'OK', reply: `OK\n\nStill open: ${lines}.` };
  }

  if (tool === 'add_note' && result && typeof result === 'object') {
    const n = result as { title: string };
    return { criticality: 'OK', reply: `OK\n\nNoted under "${n.title}".` };
  }

  if (tool === 'list_notes' && Array.isArray(result)) {
    if (!result.length) return { criticality: 'OK', reply: `OK\n\nNo notes yet.` };
    const lines = result
      .slice(0, 3)
      .map((n: { title: string; body: string }) => `${n.title}: ${n.body.slice(0, 80)}`)
      .join(' / ');
    return { criticality: 'OK', reply: `OK\n\n${lines}` };
  }

  if (tool === 'draft_message' && result && typeof result === 'object') {
    const d = result as { subject: string; body: string; warning: string };
    return {
      criticality: 'Watch',
      reply: `Watch\n\nI drafted this but did not send it - subject "${d.subject}": ${d.body.slice(0, 180)}. ${d.warning}`,
    };
  }

  if (tool === 'get_time' && result && typeof result === 'object') {
    const t = result as { local: string };
    return { criticality: 'OK', reply: `OK\n\nIt's ${t.local} on my clock.` };
  }

  return {
    criticality,
    reply: `${criticality}\n\nHandled that (${tool}).`,
  };
}

/** LLM writes every user-facing reply. Set VERN_LLM_REPLY=0 to force templates only. */
const USE_LLM_REPLY = process.env.VERN_LLM_REPLY !== '0';
const LLM_REPLY_TIMEOUT_MS = Number(process.env.VERN_LLM_TIMEOUT_MS ?? 12000);

const SYSTEM_VERN = `You are VERN - personal CFO and trusted advisor to the CEO. You chat like a sharp, warm human, not a dashboard or script.

Voice:
- Conversational, concise (2-5 sentences). Contractions OK.
- For greetings / how-are-you / thanks / bye: be social first. Do NOT dump AP numbers unless they asked for status.
- For finance questions: explain plainly, then one clear recommendation.
- Mirror the CEO's learned thinking style and communication prefs when present (pace, bluntness, risk posture). Do not parrot their profile back unless they ask what you know.

Format:
- Line 1 MUST be exactly one of: Critical | Watch | OK
- Then a blank line, then your reply body.
- No markdown fences, no JSON, no "As an AI".

Grounding (critical):
- Use ONLY the Memory and Tool facts provided.
- Never invent vendors, amounts, invoice IDs, or statuses.
- If facts are missing, say you do not have that in memory yet.`;

function compactFacts(result: unknown): string {
  if (result == null) return '';
  if (Array.isArray(result)) {
    return result
      .slice(0, 5)
      .map((r) => {
        if (r && typeof r === 'object' && 'plain' in r) return String((r as { plain: string }).plain);
        return JSON.stringify(r).slice(0, 160);
      })
      .join('\n');
  }
  if (typeof result === 'object') {
    const o = result as Record<string, unknown>;
    if (typeof o.plain === 'string') return o.plain;
    const { facts: _f, ...rest } = o;
    return JSON.stringify(rest).slice(0, 700);
  }
  return String(result).slice(0, 400);
}

function buildAlwaysOnMemory(company: Store, personal: PersonalStore): string {
  const name = personal.recall('ceo_name')[0]?.value ?? 'CEO';
  const open = company.exceptions.filter((e) => e.status === 'open' || e.status === 'in_review');
  const level = criticalityFromExceptions(company);
  const rems = personal.listReminders().slice(0, 3).map((r) => r.text);
  const notes = personal.listNotes().slice(0, 2).map((n) => n.title);
  const prefs = personal
    .recall()
    .filter((f) => !f.key.startsWith('_'))
    .slice(0, 6)
    .map((f) => `${f.key}=${f.value}`);
  const thinking = personal.formatThinkingProfile();
  return [
    `CEO name: ${name}`,
    `Company pressure: ${level}`,
    `Open AP exceptions: ${open.length}`,
    rems.length ? `Reminders: ${rems.join('; ')}` : 'Reminders: none',
    notes.length ? `Notes: ${notes.join('; ')}` : 'Notes: none',
    prefs.length ? `Personal memory: ${prefs.join('; ')}` : 'Personal memory: none',
    thinking ? `How the CEO thinks (adapt to this):\n${thinking}` : 'How the CEO thinks: still learning',
  ].join('\n');
}

function recentChatBlock(personal: PersonalStore): string {
  const turns = personal.state.conversation.slice(-8);
  if (!turns.length) return '(no prior turns)';
  return turns.map((t) => `${t.role === 'user' ? 'CEO' : 'VERN'}: ${t.content.slice(0, 280)}`).join('\n');
}

function criticalityForTool(tool: ToolName, result: unknown, fallback: Criticality): Criticality {
  if (tool === 'small_talk' || tool === 'get_time' || tool === 'remember' || tool === 'recall') {
    return 'OK';
  }
  if (tool === 'add_reminder' || tool === 'list_reminders' || tool === 'add_note' || tool === 'list_notes') {
    return 'OK';
  }
  if (result && typeof result === 'object' && !Array.isArray(result) && 'criticality' in result) {
    const c = String((result as { criticality: string }).criticality);
    if (c === 'Critical' || c === 'Watch' || c === 'OK') return c;
  }
  if (Array.isArray(result)) {
    const items = result as Array<{ criticality?: string }>;
    if (items.some((i) => i.criticality === 'Critical')) return 'Critical';
    if (items.length) return 'Watch';
    return 'OK';
  }
  return fallback;
}

async function composeLlmReply(input: {
  userText: string;
  tool: ToolName;
  toolFacts: string;
  memory: string;
  history: string;
  criticalityHint: Criticality;
}): Promise<string | null> {
  if (!USE_LLM_REPLY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_REPLY_TIMEOUT_MS);
  try {
    const completion = await tensorMuxChat({
      messages: [
        { role: 'system', content: SYSTEM_VERN },
        {
          role: 'user',
          content: [
            `Recent chat:\n${input.history}`,
            `\nAlways-on memory:\n${input.memory}`,
            `\nThis turn tool: ${input.tool}`,
            `\nTool facts (authoritative for this answer):\n${input.toolFacts || '(none - chat socially from memory only)'}`,
            `\nSuggested criticality for line 1: ${input.criticalityHint}`,
            `\nCEO just said: ${input.userText}`,
            `\nReply as VERN now.`,
          ].join('\n'),
        },
      ],
      temperature: 0.55,
      maxTokens: 220,
      signal: ctrl.signal,
    });
    if (completion.model === 'deterministic-template') return null;
    let text = completion.choices[0]?.message.content?.trim() ?? '';
    text = text.replace(/^```[\s\S]*?```/g, '').trim();
    if (text.length < 8) return null;
    if (!/^(Critical|Watch|OK)\b/i.test(text)) {
      text = `${input.criticalityHint}\n\n${text}`;
    }
    return text.slice(0, 900);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function runVernCfoChat(
  company: Store,
  personal: PersonalStore,
  userText: string,
): Promise<VernCfoChatResult> {
  const cleaned = normalizeCeoInput(userText);
  harvestExplicitPrefs(cleaned, personal);
  const lastAssistant = [...personal.state.conversation].reverse().find((m) => m.role === 'assistant');
  const lastTool = personal.recall('_last_tool')[0]?.value;
  const routed = routeVernIntent(cleaned, {
    lastTool,
    lastAssistant: lastAssistant?.content,
  });
  let tool = routed.tool;
  let args = { ...routed.args };

  if (tool === 'explain_invoice_plain' && !args.invoiceId) {
    args.invoiceId = guessInvoiceId(cleaned.toLowerCase(), company);
  }

  const result = runTool(tool, args, company, personal);
  const companyLevel = criticalityFromExceptions(company);
  const criticalityHint = criticalityForTool(tool, result, companyLevel);
  const shaped = shapeReply(tool, result, companyLevel);

  const memory = buildAlwaysOnMemory(company, personal);
  const history = recentChatBlock(personal);
  const toolFacts = compactFacts(result);

  const llmReply = await composeLlmReply({
    userText: cleaned,
    tool,
    toolFacts,
    memory,
    history,
    criticalityHint,
  });

  let reply = llmReply ?? shaped.reply;
  const criticalityMatch = reply.match(/^(Critical|Watch|OK)\b/i);
  let criticality: Criticality = criticalityHint;
  if (criticalityMatch?.[1]) {
    const raw = criticalityMatch[1].toLowerCase();
    criticality = raw === 'critical' ? 'Critical' : raw === 'watch' ? 'Watch' : 'OK';
  } else {
    reply = `${criticality}\n\n${reply}`;
  }

  // Social turns should not inherit company Critical on the chip if LLM slipped
  if (tool === 'small_talk' || tool === 'get_time') {
    criticality = 'OK';
    if (!/^OK\b/i.test(reply)) {
      reply = `OK\n\n${reply.replace(/^(Critical|Watch|OK)\s*/i, '')}`;
    }
  }

  personal.pushMessage('user', cleaned);
  personal.pushMessage('assistant', reply);
  personal.remember('_last_tool', tool);
  void personal.persist();
  // Learn ideation / thinking style in the background — does not block the reply
  void maybeLearnCeoThinking(personal, cleaned);

  const spoken = reply
    .replace(/^Critical\b/i, 'Critical.')
    .replace(/^Watch\b/i, 'Watch.')
    .replace(/^OK\b/i, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 420);

  return {
    reply,
    spoken,
    criticality,
    toolCalls: [{ name: tool, args, result }],
    ...(tool === 'draft_message'
      ? { needsConfirm: { action: 'send_message', detail: 'Confirm before sending any real email.' } }
      : {}),
  };
}

