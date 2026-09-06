import {
  DynamicsStub,
  HardGuardrailPolicy,
  NetSuiteStub,
  SapStub,
  Store,
  WorkdayStub,
  appendAuditEvent,
  applyOverrideToRules,
  buildCashSnapshot,
  buildCloseChecklist,
  buildExplainView,
  buildJudgmentCard,
  cfoDashboardRollup,
  draftVarianceNarrative,
  learnFromHumanDecision,
  listRuns,
  processInvoice,
  recordOverride,
  runAssistantChat,
  type Invoice,
  type StructuredInvoiceFallback,
  type TenantRules,
  type UserRole,
} from '@vern/core';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { z } from 'zod';

const PORT = Number(process.env.PORT ?? 4000);

/** Singleton store shared across the API process. */
let storeSingleton: Store | null = null;

export function getStore(): Store {
  if (!storeSingleton) {
    storeSingleton = new Store({ dataDir: process.env.VERN_DATA_DIR });
  }
  return storeSingleton;
}

const ROLES = ['cfo', 'controller', 'ap_clerk', 'auditor'] as const;

function parseRole(raw: string | undefined): UserRole {
  if (raw && (ROLES as readonly string[]).includes(raw)) return raw as UserRole;
  return 'controller';
}

function authFromHeaders(headers: Record<string, string | string[] | undefined>): {
  userId: string;
  role: UserRole;
} {
  const roleHeader = headers['x-vern-role'];
  const userHeader = headers['x-vern-user-id'];
  const role = parseRole(typeof roleHeader === 'string' ? roleHeader : undefined);
  const userId =
    (typeof userHeader === 'string' && userHeader) ||
    (role === 'ap_clerk'
      ? 'user-ap'
      : role === 'cfo'
        ? 'user-cfo'
        : role === 'auditor'
          ? 'user-auditor'
          : 'user-controller');
  return { userId, role };
}

async function ensureSeeded(store: Store): Promise<void> {
  if (store.tenant && store.invoices.length > 0) return;
  const loaded = await store.load();
  if (loaded && store.invoices.length > 0) return;
  store.seedDemoData();
  await bootstrapPipeline(store);
  await store.persist();
}

/** Run seed sample texts through the AP pipeline so demo queues are populated. */
async function bootstrapPipeline(store: Store): Promise<void> {
  if (!store.tenant || !store.rules) return;
  const entityId = store.entities[0]?.id ?? `${store.tenant.id}-entity-hq`;
  // Order matters: auto-post first, intentional duplicate last.
  const order = ['autoPost', 'bankChange', 'blockedVendor', 'justUnder', 'clean', 'duplicate'];
  for (const key of order) {
    const text = store.sampleTexts[key];
    if (!text) continue;
    const result = await processInvoice({
      tenantId: store.tenant.id,
      entityId,
      invoiceId: `inv-${key}`,
      document: text,
      sampleText: true,
      erp: store.erp,
      rules: store.rules,
      previousInvoices: store.invoices,
      audits: store.audits,
      exceptions: store.exceptions,
      decisions: store.decisions,
      actor: 'system',
      actorRole: 'controller',
      narrate: false,
    });
    const idx = store.invoices.findIndex((i) => i.id === result.invoice.id);
    if (idx >= 0) store.invoices[idx] = result.invoice;
    else store.invoices.push(result.invoice);
  }
}

function upsertInvoice(store: Store, invoice: Invoice): void {
  const idx = store.invoices.findIndex((i) => i.id === invoice.id);
  if (idx >= 0) store.invoices[idx] = invoice;
  else store.invoices.push(invoice);
}

async function buildServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(multipart);

  const store = getStore();
  await ensureSeeded(store);

  app.get('/health', async () => ({
    ok: true,
    service: '@vern/api',
    tenant: store.tenant?.id ?? null,
    invoiceCount: store.invoices.length,
  }));

  app.get('/v1/connectors', async () => {
    const stubs = [
      store.erp,
      new SapStub(store.tenant?.id),
      new WorkdayStub(store.tenant?.id),
      new DynamicsStub(store.tenant?.id),
    ];
    // Prefer named NetSuite from store; add siblings for demo matrix
    const named = [
      { name: 'NetSuite', connector: store.erp instanceof NetSuiteStub ? store.erp : new NetSuiteStub(store.tenant?.id) },
      { name: 'SAP', connector: stubs[1]! },
      { name: 'Workday', connector: stubs[2]! },
      { name: 'Dynamics', connector: stubs[3]! },
    ];
    const results = await Promise.all(
      named.map(async ({ name, connector }) => {
        const health = await connector.health();
        return { ...health, name };
      }),
    );
    return { connectors: results };
  });

  const ingestSchema = z.object({
    text: z.string().optional(),
    invoice: z.record(z.unknown()).optional(),
    sampleText: z.boolean().optional(),
  });

  app.post('/v1/invoices/ingest', async (req, reply) => {
    const auth = authFromHeaders(req.headers as Record<string, string | string[] | undefined>);
    const body = ingestSchema.parse(req.body ?? {});
    if (!store.tenant || !store.rules) {
      return reply.code(500).send({ error: 'store_not_seeded' });
    }
    const entityId = store.entities[0]?.id ?? `${store.tenant.id}-entity-hq`;
    const document: string | StructuredInvoiceFallback =
      body.text ??
      (body.invoice
        ? (body.invoice as unknown as StructuredInvoiceFallback)
        : (store.sampleTexts.clean ?? 'INVOICE\nTotal Amount: 100'));

    const result = await processInvoice({
      tenantId: store.tenant.id,
      entityId,
      document,
      sampleText: body.sampleText ?? typeof document === 'string',
      erp: store.erp,
      rules: store.rules,
      previousInvoices: store.invoices,
      audits: store.audits,
      exceptions: store.exceptions,
      decisions: store.decisions,
      actor: auth.userId,
      actorRole: auth.role,
      narrate: false,
    });
    upsertInvoice(store, result.invoice);
    await store.persist();
    return result;
  });

  app.post('/v1/batches/invoices', async (req, reply) => {
    const auth = authFromHeaders(req.headers as Record<string, string | string[] | undefined>);
    const body = z
      .object({
        items: z.array(
          z.object({
            text: z.string().optional(),
            invoice: z.record(z.unknown()).optional(),
          }),
        ),
      })
      .parse(req.body ?? {});

    if (!store.tenant || !store.rules) {
      return reply.code(500).send({ error: 'store_not_seeded' });
    }
    const entityId = store.entities[0]?.id ?? `${store.tenant.id}-entity-hq`;
    const results = [];
    for (const item of body.items) {
      const document: string | StructuredInvoiceFallback =
        item.text ??
        (item.invoice
          ? (item.invoice as unknown as StructuredInvoiceFallback)
          : 'INVOICE\nTotal Amount: 100');
      const result = await processInvoice({
        tenantId: store.tenant.id,
        entityId,
        document,
        sampleText: typeof document === 'string',
        erp: store.erp,
        rules: store.rules,
        previousInvoices: store.invoices,
        audits: store.audits,
        exceptions: store.exceptions,
        decisions: store.decisions,
        actor: auth.userId,
        actorRole: auth.role,
        narrate: false,
      });
      upsertInvoice(store, result.invoice);
      results.push(result);
    }
    await store.persist();
    return { count: results.length, results };
  });

  app.get('/v1/invoices', async () => ({ invoices: store.invoices }));

  app.get<{ Params: { id: string } }>('/v1/invoices/:id', async (req, reply) => {
    const invoice = store.invoices.find((i) => i.id === req.params.id);
    if (!invoice) return reply.code(404).send({ error: 'not_found' });
    return { invoice };
  });

  app.get<{ Params: { id: string } }>('/v1/invoices/:id/explain', async (req, reply) => {
    const invoice = store.invoices.find((i) => i.id === req.params.id);
    if (!invoice) return reply.code(404).send({ error: 'not_found' });
    const decision = [...store.decisions]
      .reverse()
      .find((d) => d.invoiceId === invoice.id);
    if (!decision) {
      return {
        invoice,
        explain: {
          summary: `Invoice ${invoice.invoiceNumber} has no decision yet (status=${invoice.status})`,
          reasoning: [],
          fraudSignals: [],
          guardrailHits: [],
          toolCalls: [],
          confidence: invoice.confidence ?? 0,
          route: 'exception_queue',
          outcome: 'exception_queue',
        },
      };
    }
    return { invoice, decision, explain: buildExplainView(decision) };
  });

  app.get('/v1/exceptions', async (req) => {
    const q = req.query as { role?: string };
    let items = store.exceptions.filter((e) => e.status === 'open' || e.status === 'in_review');
    if (q.role === 'controller' || q.role === 'ap_clerk') {
      items = items.filter((e) => !e.assignedRole || e.assignedRole === q.role);
    }
    if (!store.rules) return { exceptions: items, cards: [] };
    const seen = new Set<string>();
    const uniqueItems = items.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    const cards = uniqueItems
      .map((e) => {
        const inv = store.invoices.find((i) => i.id === e.invoiceId);
        if (!inv || !store.rules) return null;
        return buildJudgmentCard({ exception: e, invoice: inv, rules: store.rules });
      })
      .filter(Boolean);
    return { exceptions: uniqueItems, cards };
  });

  const decisionBody = z.object({
    userId: z.string().min(1),
    reason: z.string().min(1),
  });

  app.post<{ Params: { id: string } }>('/v1/exceptions/:id/approve', async (req, reply) => {
    const auth = authFromHeaders(req.headers as Record<string, string | string[] | undefined>);
    const body = decisionBody.parse(req.body ?? {});
    const exception = store.exceptions.find((e) => e.id === req.params.id);
    if (!exception) return reply.code(404).send({ error: 'not_found' });
    if (exception.status === 'resolved') {
      return reply.code(409).send({ error: 'already_resolved' });
    }

    const invoice = store.invoices.find((i) => i.id === exception.invoiceId);
    if (!invoice || !store.rules || !store.tenant) {
      return reply.code(500).send({ error: 'missing_invoice_or_rules' });
    }

    const role = auth.role;
    const userId = body.userId || auth.userId;
    const vendor = invoice.vendorId
      ? store.vendors.find((v) => v.id === invoice.vendorId)
      : undefined;
    const po = invoice.poId
      ? store.purchaseOrders.find((p) => p.id === invoice.poId)
      : undefined;

    const policy = new HardGuardrailPolicy();
    const guard = policy.evaluate(invoice, {
      tenantId: store.tenant.id,
      actor: userId,
      actorRole: role,
      approvalAmountLimit: store.rules.approvalAmountLimit,
      autoPostThreshold: store.rules.autoPostThreshold,
      blockedVendorIds: store.rules.blockedVendorIds,
      shortPayTolerance: store.rules.shortPayTolerance,
      ...(vendor ? { matchedVendor: vendor } : {}),
      ...(po ? { matchedPo: po } : {}),
      previousInvoices: store.invoices,
    });

    // SoD: AP clerk cannot approve controller-gated or blocked items
    if (role === 'ap_clerk' && (guard.requireController || guard.blocked || exception.assignedRole === 'controller')) {
      return reply.code(403).send({
        error: 'sod_violation',
        message: 'SoD: AP clerk cannot approve this exception; controller required',
        hits: guard.hits,
      });
    }
    if (guard.blocked && role !== 'cfo') {
      return reply.code(403).send({
        error: 'blocked_vendor',
        message: 'Blocked vendor requires CFO override',
        hits: guard.hits,
      });
    }
    if (role === 'auditor') {
      return reply.code(403).send({ error: 'forbidden', message: 'Auditors cannot approve' });
    }

    const before = { exception: structuredClone(exception), invoice: structuredClone(invoice) };
    exception.status = 'resolved';
    exception.resolvedAt = new Date().toISOString();

    let postingId: string | undefined;
    if (!guard.blocked) {
      const post = await store.erp.postInvoice(invoice);
      if (post.status === 'posted') {
        postingId = post.postingId;
        invoice.status = 'posted';
        invoice.erpPostingId = postingId;
      } else {
        invoice.status = 'overridden';
      }
    } else {
      invoice.status = 'overridden';
    }
    invoice.updatedAt = new Date().toISOString();
    upsertInvoice(store, invoice);

    recordOverride(store.overrides, store.audits, {
      tenantId: store.tenant.id,
      who: userId,
      whoRole: role,
      why: body.reason,
      before,
      after: { exception, invoice, postingId },
      invoiceId: invoice.id,
    });

    const learned = learnFromHumanDecision({
      rules: store.rules,
      invoice,
      exception,
      action: 'approve',
    });
    if (learned.learned.length) {
      store.rules = learned.rules;
      appendAuditEvent(store.audits, {
        tenantId: store.tenant.id,
        entityType: 'rules',
        entityId: store.tenant.id,
        action: 'policy_learn',
        actor: userId,
        actorRole: role,
        reason: learned.learned.join('; '),
        after: store.rules,
      });
    }

    appendAuditEvent(store.audits, {
      tenantId: store.tenant.id,
      entityType: 'exception',
      entityId: exception.id,
      action: 'approve',
      actor: userId,
      actorRole: role,
      reason: body.reason,
      after: { postingId, invoiceStatus: invoice.status, learned: learned.learned },
    });
    await store.persist();
    return { exception, invoice, postingId, learned: learned.learned, rules: store.rules };
  });

  app.post<{ Params: { id: string } }>('/v1/exceptions/:id/reject', async (req, reply) => {
    const auth = authFromHeaders(req.headers as Record<string, string | string[] | undefined>);
    const body = decisionBody.parse(req.body ?? {});
    const exception = store.exceptions.find((e) => e.id === req.params.id);
    if (!exception) return reply.code(404).send({ error: 'not_found' });
    if (exception.status === 'resolved') {
      return reply.code(409).send({ error: 'already_resolved' });
    }
    if (auth.role === 'auditor') {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const invoice = store.invoices.find((i) => i.id === exception.invoiceId);
    const before = {
      exception: structuredClone(exception),
      invoice: invoice ? structuredClone(invoice) : null,
    };
    exception.status = 'resolved';
    exception.resolvedAt = new Date().toISOString();
    if (invoice) {
      invoice.status = 'rejected';
      invoice.updatedAt = new Date().toISOString();
      upsertInvoice(store, invoice);
    }

    if (store.tenant) {
      recordOverride(store.overrides, store.audits, {
        tenantId: store.tenant.id,
        who: body.userId || auth.userId,
        whoRole: auth.role,
        why: body.reason,
        before,
        after: { exception, invoice },
        invoiceId: exception.invoiceId,
      });
      appendAuditEvent(store.audits, {
        tenantId: store.tenant.id,
        entityType: 'exception',
        entityId: exception.id,
        action: 'reject',
        actor: body.userId || auth.userId,
        actorRole: auth.role,
        reason: body.reason,
      });
    }
    await store.persist();
    return { exception, invoice };
  });

  app.get('/v1/audit/export', async (_req, reply) => {
    const payload = {
      exportedAt: new Date().toISOString(),
      tenantId: store.tenant?.id,
      audits: store.audits,
      overrides: store.overrides,
      decisions: store.decisions,
    };
    reply.header('content-type', 'application/json');
    reply.header(
      'content-disposition',
      `attachment; filename="vern-audit-${store.tenant?.id ?? 'export'}.json"`,
    );
    return payload;
  });

  app.get('/v1/dashboards/cfo', async () => {
    return cfoDashboardRollup(store.invoices, store.exceptions, store.audits);
  });

  app.get('/v1/close/checklist', async () => ({
    items: buildCloseChecklist(store.invoices, store.exceptions),
  }));

  app.get('/v1/close/cash', async () => buildCashSnapshot(store.invoices, store.exceptions));

  app.get('/v1/close/variance', async () =>
    draftVarianceNarrative(store.invoices, store.exceptions),
  );

  app.get('/v1/traces', async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(50, Number(q.limit ?? 20) || 20);
    return { runs: listRuns(limit) };
  });

  app.post('/v1/query', async (req) => {
    const body = z.object({ q: z.string() }).parse(req.body ?? {});
    const q = body.q.toLowerCase();
    let invoices = [...store.invoices];

    if (q.includes('acme')) {
      invoices = invoices.filter(
        (i) =>
          (i.vendorName ?? '').toLowerCase().includes('acme') ||
          i.tenantId.toLowerCase().includes('acme'),
      );
    }
    if (q.includes('flagged') || q.includes('exception')) {
      const flaggedIds = new Set(
        store.exceptions.filter((e) => e.status !== 'resolved').map((e) => e.invoiceId),
      );
      invoices = invoices.filter(
        (i) => flaggedIds.has(i.id) || i.status === 'exception' || i.status === 'rejected',
      );
    }
    if (q.includes('quarter') || /\bq[1-4]\b/.test(q)) {
      const now = new Date();
      const quarter = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), quarter * 3, 1);
      invoices = invoices.filter((i) => {
        const d = Date.parse(i.invoiceDate);
        return Number.isFinite(d) && d >= start.getTime();
      });
    }

    // Keyword fallback across invoice fields
    if (
      !q.includes('acme') &&
      !q.includes('flagged') &&
      !q.includes('exception') &&
      !q.includes('quarter') &&
      !/\bq[1-4]\b/.test(q) &&
      q.trim()
    ) {
      invoices = invoices.filter((i) =>
        JSON.stringify(i).toLowerCase().includes(q.trim()),
      );
    }

    return { q: body.q, count: invoices.length, invoices };
  });

  app.get('/v1/rules', async () => ({ rules: store.rules }));

  app.put('/v1/rules', async (req, reply) => {
    const auth = authFromHeaders(req.headers as Record<string, string | string[] | undefined>);
    if (auth.role !== 'controller' && auth.role !== 'cfo') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (!store.rules || !store.tenant) {
      return reply.code(500).send({ error: 'store_not_seeded' });
    }
    const patch = z
      .object({
        autoPostThreshold: z.number().optional(),
        approvalAmountLimit: z.number().optional(),
        blockedVendorIds: z.array(z.string()).optional(),
        shortPayTolerance: z.number().optional(),
      })
      .parse(req.body ?? {});
    const before = structuredClone(store.rules);
    store.rules = applyOverrideToRules(store.rules, patch as Partial<TenantRules>);
    recordOverride(store.overrides, store.audits, {
      tenantId: store.tenant.id,
      who: auth.userId,
      whoRole: auth.role,
      why: 'rules_update',
      before,
      after: store.rules,
    });
    await store.persist();
    return { rules: store.rules };
  });

  app.post('/v1/assistant/chat', async (req, reply) => {
    const auth = authFromHeaders(req.headers as Record<string, string | string[] | undefined>);
    if (!store.tenant || !store.rules) {
      return reply.code(500).send({ error: 'store_not_seeded' });
    }
    const body = z
      .object({
        messages: z
          .array(
            z.object({
              role: z.enum(['system', 'user', 'assistant']),
              content: z.string(),
            }),
          )
          .min(1),
      })
      .parse(req.body ?? {});

    const result = await runAssistantChat({
      messages: body.messages,
      role: auth.role,
      userId: auth.userId,
      invoices: store.invoices,
      exceptions: store.exceptions,
      audits: store.audits,
      decisions: store.decisions,
      rules: store.rules,
      tenantId: store.tenant.id,
      approveException: async (id, reason) => {
        const res = await app.inject({
          method: 'POST',
          url: `/v1/exceptions/${id}/approve`,
          headers: {
            'content-type': 'application/json',
            'x-vern-role': auth.role,
            'x-vern-user-id': auth.userId,
          },
          payload: { userId: auth.userId, reason },
        });
        try {
          return JSON.parse(res.body);
        } catch {
          return { statusCode: res.statusCode, body: res.body };
        }
      },
      rejectException: async (id, reason) => {
        const res = await app.inject({
          method: 'POST',
          url: `/v1/exceptions/${id}/reject`,
          headers: {
            'content-type': 'application/json',
            'x-vern-role': auth.role,
            'x-vern-user-id': auth.userId,
          },
          payload: { userId: auth.userId, reason },
        });
        try {
          return JSON.parse(res.body);
        } catch {
          return { statusCode: res.statusCode, body: res.body };
        }
      },
    });

    return result;
  });

  return app;
}

const app = await buildServer();
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`VERN API listening on http://127.0.0.1:${PORT}`);
