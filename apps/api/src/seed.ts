import { Store, processInvoice } from '@vern/core';

const store = new Store({ dataDir: process.env.VERN_DATA_DIR });
store.seedDemoData();

if (store.tenant && store.rules) {
  const entityId = store.entities[0]?.id ?? `${store.tenant.id}-entity-hq`;
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

const path = await store.persist();
console.log(
  `Seeded tenant=${store.tenant?.id} invoices=${store.invoices.length} exceptions=${store.exceptions.length} autoPosted=${store.invoices.filter((i) => i.status === 'auto_posted' || i.status === 'posted').length}` +
    (path ? ` persisted=${path}` : ''),
);
