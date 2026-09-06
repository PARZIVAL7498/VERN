import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PersonalStore, Store, processInvoice } from '@vern/core';

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadEnvFile(path.resolve(process.cwd(), '../../.env'));
  loadEnvFile(path.resolve(process.cwd(), '.env'));

  const dataDir = process.env.VERN_DATA_DIR || path.resolve(process.cwd(), 'data');

  const company = new Store({ dataDir });
  company.seedDemoData();

  if (company.tenant && company.rules) {
    const entityId = company.entities[0]?.id ?? `${company.tenant.id}-entity-hq`;
    const order = ['autoPost', 'bankChange', 'blockedVendor', 'justUnder', 'clean', 'duplicate'];
    for (const key of order) {
      const text = company.sampleTexts[key];
      if (!text) continue;
      const result = await processInvoice({
        tenantId: company.tenant.id,
        entityId,
        invoiceId: `inv-${key}`,
        document: text,
        sampleText: true,
        erp: company.erp,
        rules: company.rules,
        previousInvoices: company.invoices,
        audits: company.audits,
        exceptions: company.exceptions,
        decisions: company.decisions,
        actor: 'system',
        actorRole: 'controller',
        narrate: false,
      });
      const idx = company.invoices.findIndex((i) => i.id === result.invoice.id);
      if (idx >= 0) company.invoices[idx] = result.invoice;
      else company.invoices.push(result.invoice);
    }
  }

  const companyPath = await company.persist();

  const personal = new PersonalStore({ dataDir });
  personal.seed();
  const personalPath = await personal.persist();

  console.log(
    `Seeded company invoices=${company.invoices.length} exceptions=${company.exceptions.length} → ${companyPath}`,
  );
  console.log(`Seeded personal facts=${personal.state.facts.length} → ${personalPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
