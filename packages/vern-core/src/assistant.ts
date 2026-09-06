import { tensorMuxChat, type ChatMessage } from './agent.js';
import {
  buildCashSnapshot,
  buildCloseChecklist,
  draftVarianceNarrative,
} from './close.js';
import type { ExceptionItem, Invoice, UserRole } from './domain.js';
import { buildExplainView } from './governance.js';
import { buildJudgmentCard, canRoleAct } from './judgment.js';
import type { TenantRules } from './rules.js';
import { cfoDashboardRollup } from './analytics.js';
import type { AuditEvent, Decision } from './domain.js';
import { endRun, endSpan, startRun, startSpan } from './tracing.js';

export interface AssistantToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AssistantChatInput {
  messages: ChatMessage[];
  role: UserRole;
  userId: string;
  invoices: Invoice[];
  exceptions: ExceptionItem[];
  audits: AuditEvent[];
  decisions: Decision[];
  rules: TenantRules;
  tenantId: string;
  /** Injected so approve/reject hit the same path as HTTP (passed from API). */
  approveException: (id: string, reason: string) => Promise<unknown>;
  rejectException: (id: string, reason: string) => Promise<unknown>;
}

export interface AssistantChatResult {
  reply: string;
  toolCalls: AssistantToolCall[];
}

type ToolName =
  | 'list_exceptions'
  | 'explain_invoice'
  | 'approve_exception'
  | 'reject_exception'
  | 'get_close_pack'
  | 'get_cfo_dashboard';

const TOOL_NAMES: ToolName[] = [
  'list_exceptions',
  'explain_invoice',
  'approve_exception',
  'reject_exception',
  'get_close_pack',
  'get_cfo_dashboard',
];

async function runTool(
  name: ToolName,
  args: Record<string, unknown>,
  ctx: AssistantChatInput,
): Promise<unknown> {
  switch (name) {
    case 'get_cfo_dashboard':
      return cfoDashboardRollup(ctx.invoices, ctx.exceptions, ctx.audits);
    case 'get_close_pack':
      return {
        checklist: buildCloseChecklist(ctx.invoices, ctx.exceptions),
        cash: buildCashSnapshot(ctx.invoices, ctx.exceptions),
        variance: draftVarianceNarrative(ctx.invoices, ctx.exceptions),
      };
    case 'list_exceptions': {
      const open = ctx.exceptions.filter((e) => e.status === 'open' || e.status === 'in_review');
      return open.map((e) => {
        const inv = ctx.invoices.find((i) => i.id === e.invoiceId);
        if (!inv) return { exceptionId: e.id, invoiceId: e.invoiceId, reasons: e.reasons };
        return buildJudgmentCard({ exception: e, invoice: inv, rules: ctx.rules });
      });
    }
    case 'explain_invoice': {
      const id = String(args.invoiceId ?? args.invoice_id ?? '');
      const inv = ctx.invoices.find((i) => i.id === id || i.invoiceNumber === id);
      const dec =
        ctx.decisions.filter((d) => d.invoiceId === inv?.id).sort((a, b) =>
          a.createdAt < b.createdAt ? 1 : -1,
        )[0] ?? null;
      if (!inv) return { error: 'invoice_not_found' };
      return {
        invoice: inv,
        explain: dec
          ? buildExplainView(dec)
          : { summary: 'No decision recorded yet', reasoning: [], fraudSignals: [], guardrailHits: [] },
      };
    }
    case 'approve_exception': {
      const id = String(args.exceptionId ?? args.exception_id ?? '');
      const reason = String(args.reason ?? 'Approved via Assist');
      const ex = ctx.exceptions.find((e) => e.id === id);
      const inv = ex ? ctx.invoices.find((i) => i.id === ex.invoiceId) : undefined;
      if (!ex || !inv) return { error: 'not_found' };
      const card = buildJudgmentCard({ exception: ex, invoice: inv, rules: ctx.rules });
      const gate = canRoleAct(ctx.role, card, 'approve');
      if (!gate.ok) return { error: 'sod_violation', message: gate.message };
      return ctx.approveException(id, reason);
    }
    case 'reject_exception': {
      const id = String(args.exceptionId ?? args.exception_id ?? '');
      const reason = String(args.reason ?? 'Rejected via Assist');
      return ctx.rejectException(id, reason);
    }
    default:
      return { error: 'unknown_tool' };
  }
}

/** Keyword router when TensorMux is unavailable — keeps the demo alive. */
export function deterministicAssistantRoute(userText: string): {
  tool: ToolName;
  args: Record<string, unknown>;
} {
  const q = userText.toLowerCase();
  if (
    q.includes('blocking') ||
    q.includes('on fire') ||
    q.includes('stuck') ||
    q.includes('exception') ||
    q.includes('queue') ||
    q.includes('flagged')
  ) {
    return { tool: 'list_exceptions', args: {} };
  }
  if (q.includes('cash') || q.includes('variance') || q.includes('checklist') || q.includes('close pack')) {
    return { tool: 'get_close_pack', args: {} };
  }
  if (q.includes('close') && !q.includes('blocking')) {
    return { tool: 'get_close_pack', args: {} };
  }
  if (q.includes('dashboard') || q.includes('rollup')) {
    return { tool: 'get_cfo_dashboard', args: {} };
  }
  if (q.includes('explain') || q.includes('why') || q.includes('northwind') || q.includes('bank')) {
    return { tool: 'explain_invoice', args: { invoiceId: guessInvoiceRef(q) } };
  }
  if (q.includes('approve')) {
    return {
      tool: 'approve_exception',
      args: { exceptionId: '', reason: 'Approved via Assist (deterministic)' },
    };
  }
  if (q.includes('reject')) {
    return {
      tool: 'reject_exception',
      args: { exceptionId: '', reason: 'Rejected via Assist' },
    };
  }
  return { tool: 'get_cfo_dashboard', args: {} };
}

function guessInvoiceRef(q: string): string {
  if (q.includes('northwind') || q.includes('bank')) return 'inv-bankChange';
  if (q.includes('shadow') || q.includes('blocked')) return 'inv-blockedVendor';
  if (q.includes('duplicate')) return 'inv-duplicate';
  if (q.includes('under') || q.includes('just')) return 'inv-justUnder';
  if (q.includes('auto')) return 'inv-autoPost';
  return 'inv-clean';
}

function formatToolReply(tool: ToolName, result: unknown): string {
  if (tool === 'list_exceptions' && Array.isArray(result)) {
    if (result.length === 0) return 'Exception queue is clear — nothing blocking close from AP exceptions.';
    const lines = result.slice(0, 5).map((c: JudgmentCardLike) => {
      return `• ${c.invoiceNumber ?? c.invoiceId} (${c.vendorName ?? '?'}) — ${c.riskSummary ?? c.severity}; recommend ${c.recommendedAction}: ${c.recommendationRationale ?? ''}`;
    });
    return `Open exceptions (${result.length}):\n${lines.join('\n')}`;
  }
  if (tool === 'get_cfo_dashboard' && result && typeof result === 'object') {
    const d = result as {
      openExceptions: number;
      autoPostedCount: number;
      totalSpend: number;
      topExceptionReasons: Array<{ reason: string; count: number }>;
    };
    const top = d.topExceptionReasons?.[0]?.reason ?? 'n/a';
    return `CFO rollup: ${d.openExceptions} open exceptions, ${d.autoPostedCount} auto/posted, spend $${d.totalSpend}. Top reason: ${top}.`;
  }
  if (tool === 'get_close_pack' && result && typeof result === 'object') {
    const p = result as {
      cash: { projectedCashOut7d: number; openExceptionsAmount: number };
      variance: { draft: string };
      checklist: Array<{ label: string; status: string }>;
    };
    const blocked = p.checklist.filter((c) => c.status !== 'done').map((c) => c.label);
    return `Close pack: projected 7d cash out $${p.cash.projectedCashOut7d}; open exception $ ${p.cash.openExceptionsAmount}. Pending checklist: ${blocked.join('; ') || 'none'}.\n\n${p.variance.draft}`;
  }
  if (tool === 'explain_invoice' && result && typeof result === 'object') {
    const r = result as { explain?: { summary?: string }; invoice?: { invoiceNumber?: string }; error?: string };
    if (r.error) return 'I could not find that invoice.';
    return `Explain ${r.invoice?.invoiceNumber ?? ''}: ${r.explain?.summary ?? JSON.stringify(result)}`;
  }
  if (typeof result === 'object' && result && 'error' in result) {
    const e = result as { error: string; message?: string };
    return e.message ?? `Action failed: ${e.error}`;
  }
  return `Done (${tool}). ${typeof result === 'string' ? result : JSON.stringify(result).slice(0, 400)}`;
}

type JudgmentCardLike = {
  invoiceId?: string;
  invoiceNumber?: string;
  vendorName?: string;
  riskSummary?: string;
  severity?: string;
  recommendedAction?: string;
  recommendationRationale?: string;
};

/**
 * Thin controller assistant: one tool call per turn (deterministic or TensorMux-guided).
 */
export async function runAssistantChat(ctx: AssistantChatInput): Promise<AssistantChatResult> {
  const run = startRun('assistant_chat', { role: ctx.role, tenantId: ctx.tenantId });
  const span = startSpan(run, 'assistant.turn');
  const lastUser = [...ctx.messages].reverse().find((m) => m.role === 'user');
  const userText = lastUser?.content ?? '';

  let tool: ToolName;
  let args: Record<string, unknown>;

  const routed = deterministicAssistantRoute(userText);
  tool = routed.tool;
  args = { ...routed.args };

  // Resolve approve/reject to first open exception matching recommendation when id empty
  if (
    (tool === 'approve_exception' || tool === 'reject_exception') &&
    !args.exceptionId
  ) {
    const open = ctx.exceptions.filter((e) => e.status === 'open' || e.status === 'in_review');
    const prefer = open.find((e) => {
      const inv = ctx.invoices.find((i) => i.id === e.invoiceId);
      if (!inv) return false;
      const card = buildJudgmentCard({ exception: e, invoice: inv, rules: ctx.rules });
      return tool === 'approve_exception'
        ? card.recommendedAction === 'approve'
        : card.recommendedAction === 'reject';
    });
    args.exceptionId = (prefer ?? open[0])?.id ?? '';
  }

  // Optional: ask TensorMux to pick a tool (best-effort); fall back to router
  try {
    const completion = await tensorMuxChat({
      messages: [
        {
          role: 'system',
          content: `You are VERN Assist, a month-end AP controller radio for the Office of the CFO.
Reply with ONLY a JSON object: {"tool":"<name>","args":{...}} 
Allowed tools: ${TOOL_NAMES.join(', ')}.
Never suggest disabling hard guardrails. Prefer list_exceptions when asked what is blocking close.`,
        },
        { role: 'user', content: userText },
      ],
      temperature: 0,
    });
    const raw = completion.choices[0]?.message.content?.trim() ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch && completion.model !== 'deterministic-template') {
      const parsed = JSON.parse(jsonMatch[0]) as { tool?: string; args?: Record<string, unknown> };
      if (parsed.tool && (TOOL_NAMES as string[]).includes(parsed.tool)) {
        tool = parsed.tool as ToolName;
        args = { ...args, ...(parsed.args ?? {}) };
      }
    }
  } catch {
    // keep deterministic route
  }

  const toolSpan = startSpan(run, `tool.${tool}`, args);
  const result = await runTool(tool, args, ctx);
  endSpan(toolSpan, 'ok', result);

  const reply = formatToolReply(tool, result);
  const toolCalls: AssistantToolCall[] = [{ name: tool, args, result }];

  endSpan(span, 'ok', { tool, replyPreview: reply.slice(0, 120) });
  endRun(run);
  return { reply, toolCalls };
}
