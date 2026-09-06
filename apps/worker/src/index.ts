/**
 * Batch worker — processes high-volume invoice text jobs against @vern/core.
 * In-memory queue (Redis optional later). Polls API or runs local Store when
 * VERN_WORKER_MODE=local (default).
 */
import { Store, processInvoice } from '@vern/core';

const INTERVAL_MS = Number(process.env.VERN_WORKER_INTERVAL_MS ?? 5000);
const API = process.env.NEXT_PUBLIC_API_URL ?? process.env.VERN_API_URL ?? 'http://127.0.0.1:4000';

interface QueueItem {
  id: string;
  text: string;
}

const localQueue: QueueItem[] = [];

export function enqueueLocal(text: string): string {
  const id = `job-${Date.now()}`;
  localQueue.push({ id, text });
  return id;
}

async function drainViaApi(): Promise<number> {
  // Pull nothing from remote queue in demo — worker posts sample if BATCH_DEMO=1
  if (process.env.BATCH_DEMO !== '1') return 0;
  const res = await fetch(`${API}/v1/batches/invoices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vern-role': 'controller' },
    body: JSON.stringify({
      items: [
        {
          text: [
            'INVOICE',
            'Invoice Number: INV-BATCH-DEMO',
            'Invoice Date: 2026-09-05',
            'Vendor Name: Acme Supplies Co',
            'PO Number: PO-1003',
            'Currency: USD',
            'Total Amount: 1200',
            'Bank Account ****4412',
            '1) Batch paper 60 x 20 = 1200',
          ].join('\n'),
        },
      ],
    }),
  });
  if (!res.ok) {
    console.error('batch post failed', await res.text());
    return 0;
  }
  const body = (await res.json()) as { results?: unknown[] };
  console.log(`batch demo posted results=${body.results?.length ?? 0}`);
  process.env.BATCH_DEMO = '0';
  return body.results?.length ?? 0;
}

async function drainLocal(store: Store): Promise<number> {
  if (!store.tenant || !store.rules) return 0;
  let n = 0;
  while (localQueue.length) {
    const job = localQueue.shift()!;
    const result = await processInvoice({
      tenantId: store.tenant.id,
      entityId: store.entities[0]?.id ?? `${store.tenant.id}-entity-hq`,
      invoiceId: `inv-${job.id}`,
      document: job.text,
      sampleText: true,
      erp: store.erp,
      rules: store.rules,
      previousInvoices: store.invoices,
      audits: store.audits,
      exceptions: store.exceptions,
      decisions: store.decisions,
      narrate: false,
    });
    store.invoices.push(result.invoice);
    n += 1;
    console.log(`local job ${job.id} → ${result.decision.outcome}`);
  }
  if (n) await store.persist();
  return n;
}

async function tick(store: Store): Promise<void> {
  const viaApi = await drainViaApi();
  const viaLocal = await drainLocal(store);
  if (viaApi + viaLocal === 0) {
    // heartbeat
  }
}

async function main(): Promise<void> {
  const store = new Store({ dataDir: process.env.VERN_DATA_DIR });
  const loaded = await store.load();
  if (!loaded || !store.tenant) {
    store.seedDemoData();
  }
  console.log(`VERN worker started (interval=${INTERVAL_MS}ms) tenant=${store.tenant?.id}`);
  enqueueLocal(
    [
      'INVOICE',
      'Invoice Number: INV-WORKER-1',
      'Invoice Date: 2026-09-05',
      'Vendor Name: Acme Supplies Co',
      'PO Number: PO-1003',
      'Currency: USD',
      'Total Amount: 800',
      'Bank Account ****4412',
      '1) Worker supplies 40 x 20 = 800',
    ].join('\n'),
  );
  await tick(store);
  setInterval(() => {
    void tick(store);
  }, INTERVAL_MS);
}

void main();
