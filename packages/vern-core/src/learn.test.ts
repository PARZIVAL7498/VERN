import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HardGuardrailPolicy } from './governance.js';
import { learnFromHumanDecision } from './learn.js';
import { extractFromSampleText } from './documents/ocr.js';
import { defaultTenantRules } from './rules.js';
import type { ExceptionItem, Invoice } from './domain.js';

describe('learnFromHumanDecision', () => {
  it('raises approval limit after just-under approve', () => {
    const rules = { ...defaultTenantRules('t1'), approvalAmountLimit: 10000 };
    const invoice = {
      id: 'inv-1',
      tenantId: 't1',
      entityId: 'e1',
      invoiceNumber: 'INV-1',
      invoiceDate: '2026-09-01',
      currency: 'USD',
      subtotal: 9900,
      tax: 0,
      totalAmount: 9900,
      lines: [],
      status: 'exception',
      createdAt: '',
      updatedAt: '',
    } satisfies Invoice;
    const exception = {
      id: 'ex-1',
      tenantId: 't1',
      invoiceId: 'inv-1',
      severity: 'medium',
      reasons: ['just_under_threshold'],
      status: 'open',
      createdAt: '',
    } satisfies ExceptionItem;

    const out = learnFromHumanDecision({
      rules,
      invoice,
      exception,
      action: 'approve',
    });
    assert.ok(out.rules.approvalAmountLimit > 10000);
    assert.ok(out.learned.some((l) => l.includes('approvalAmountLimit')));
  });

  it('does not clear blocked vendor via learn', () => {
    const rules = {
      ...defaultTenantRules('t1'),
      blockedVendorIds: ['v-blocked'],
    };
    const invoice = {
      id: 'inv-2',
      tenantId: 't1',
      entityId: 'e1',
      vendorId: 'v-blocked',
      invoiceNumber: 'INV-2',
      invoiceDate: '2026-09-01',
      currency: 'USD',
      subtotal: 100,
      tax: 0,
      totalAmount: 100,
      lines: [],
      status: 'exception',
      createdAt: '',
      updatedAt: '',
    } satisfies Invoice;
    const exception = {
      id: 'ex-2',
      tenantId: 't1',
      invoiceId: 'inv-2',
      severity: 'critical',
      reasons: ['blocked_vendor'],
      status: 'open',
      createdAt: '',
    } satisfies ExceptionItem;

    const out = learnFromHumanDecision({
      rules,
      invoice,
      exception,
      action: 'approve',
    });
    assert.deepEqual(out.rules.blockedVendorIds, ['v-blocked']);
  });
});

describe('HardGuardrailPolicy', () => {
  it('blocks listed vendors', () => {
    const policy = new HardGuardrailPolicy();
    const invoice = {
      id: 'inv-b',
      tenantId: 't1',
      entityId: 'e1',
      vendorId: 'v-bad',
      invoiceNumber: 'INV-B',
      invoiceDate: '2026-09-01',
      currency: 'USD',
      subtotal: 50,
      tax: 0,
      totalAmount: 50,
      lines: [],
      status: 'extracted',
      createdAt: '',
      updatedAt: '',
    } satisfies Invoice;

    const result = policy.evaluate(invoice, {
      tenantId: 't1',
      actor: 'user-ap',
      actorRole: 'ap_clerk',
      approvalAmountLimit: 10000,
      autoPostThreshold: 0.85,
      blockedVendorIds: ['v-bad'],
      shortPayTolerance: 50,
    });
    assert.equal(result.blocked, true);
    assert.ok(result.hits.includes('blocked_vendor'));
  });
});

describe('extractFromSampleText', () => {
  it('parses demo invoice fields', () => {
    const draft = extractFromSampleText(
      [
        'INVOICE',
        'Invoice Number: INV-TEST-1',
        'Invoice Date: 2026-09-05',
        'Vendor Name: Acme Supplies Co',
        'PO Number: PO-1003',
        'Currency: USD',
        'Total Amount: 1200',
        'Bank Account ****4412',
        '1) Paper 60 x 20 = 1200',
      ].join('\n'),
    );
    assert.equal(draft.invoiceNumber, 'INV-TEST-1');
    assert.equal(draft.vendorName, 'Acme Supplies Co');
    assert.equal(draft.totalAmount, 1200);
    assert.equal(draft.bankAccountLast4, '4412');
  });
});
