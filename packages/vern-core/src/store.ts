import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NetSuiteStub } from './connectors/erp.js';
import type {
  AuditEvent,
  Decision,
  Entity,
  ExceptionItem,
  HumanOverride,
  Invoice,
  PurchaseOrder,
  Tenant,
  UserRole,
  Vendor,
} from './domain.js';
import { defaultTenantRules, type TenantRules } from './rules.js';

export interface StoreUser {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface StoreSnapshot {
  tenant: Tenant;
  entities: Entity[];
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  invoices: Invoice[];
  users: StoreUser[];
  rules: TenantRules;
  audits: AuditEvent[];
  decisions: Decision[];
  exceptions: ExceptionItem[];
  overrides: HumanOverride[];
  sampleTexts: Record<string, string>;
}

export class Store {
  tenant: Tenant | null = null;
  entities: Entity[] = [];
  vendors: Vendor[] = [];
  purchaseOrders: PurchaseOrder[] = [];
  invoices: Invoice[] = [];
  users: StoreUser[] = [];
  rules: TenantRules | null = null;
  audits: AuditEvent[] = [];
  decisions: Decision[] = [];
  exceptions: ExceptionItem[] = [];
  overrides: HumanOverride[] = [];
  sampleTexts: Record<string, string> = {};
  erp = new NetSuiteStub('acme-corp');

  private dataDir: string | undefined;

  constructor(options?: { dataDir?: string }) {
    this.dataDir = options?.dataDir ?? process.env.VERN_DATA_DIR;
  }

  seedDemoData(): StoreSnapshot {
    const tenantId = 'acme-corp';
    const now = new Date().toISOString();
    this.tenant = { id: tenantId, name: 'Acme Corporation', createdAt: now };

    this.entities = [
      {
        id: `${tenantId}-entity-hq`,
        tenantId,
        code: 'HQ',
        name: 'Acme HQ',
        currency: 'USD',
      },
      {
        id: `${tenantId}-entity-emea`,
        tenantId,
        code: 'EMEA',
        name: 'Acme EMEA',
        currency: 'EUR',
      },
    ];

    this.erp = new NetSuiteStub(tenantId);
    this.vendors = this.erp.listVendors();
    this.purchaseOrders = this.erp.listPurchaseOrders();

    const blocked = this.vendors.find((v) => v.blocked);

    this.rules = {
      ...defaultTenantRules(tenantId),
      blockedVendorIds: blocked ? [blocked.id] : [],
      approvalAmountLimit: 10000,
      autoPostThreshold: 0.85,
      shortPayTolerance: 50,
    };

    this.users = [
      {
        id: 'user-cfo',
        tenantId,
        email: 'cfo@acme.example',
        displayName: 'Casey CFO',
        role: 'cfo',
      },
      {
        id: 'user-controller',
        tenantId,
        email: 'controller@acme.example',
        displayName: 'Chris Controller',
        role: 'controller',
      },
      {
        id: 'user-ap',
        tenantId,
        email: 'ap@acme.example',
        displayName: 'Alex AP Clerk',
        role: 'ap_clerk',
      },
      {
        id: 'user-auditor',
        tenantId,
        email: 'auditor@acme.example',
        displayName: 'Avery Auditor',
        role: 'auditor',
      },
    ];

    this.sampleTexts = {
      clean: [
        'INVOICE',
        'Invoice Number: INV-9001',
        'Invoice Date: 2026-09-01',
        'Due Date: 2026-10-01',
        'Vendor Name: Acme Supplies Co',
        'PO Number: PO-1001',
        'Currency: USD',
        'Subtotal: 12000',
        'Tax: 500',
        'Total Amount: 12500',
        'Bank Account ****4412',
        '1) Office paper reams 500 x 20 = 10000',
        '2) Shipping 1 x 2500 = 2500',
      ].join('\n'),
      autoPost: [
        'INVOICE',
        'Invoice Number: INV-AUTO-1',
        'Invoice Date: 2026-09-01',
        'Vendor Name: Acme Supplies Co',
        'PO Number: PO-1003',
        'Currency: USD',
        'Subtotal: 4500',
        'Tax: 0',
        'Total Amount: 4500',
        'Bank Account ****4412',
        '1) Office paper reams 225 x 20 = 4500',
      ].join('\n'),
      blockedVendor: [
        'INVOICE',
        'Invoice Number: INV-SHADOW-1',
        'Invoice Date: 2026-09-02',
        'Vendor Name: Shadow Logistics LLC',
        'Currency: USD',
        'Total Amount: 2500',
        '1) Freight 1 x 2500 = 2500',
      ].join('\n'),
      bankChange: [
        'INVOICE',
        'Invoice Number: INV-NW-44',
        'Invoice Date: 2026-09-03',
        'Vendor Name: Northwind Paper',
        'PO Number: PO-1002',
        'Currency: USD',
        'Total Amount: 4800',
        'Bank Account ****1111',
        '1) Specialty paper 200 x 24 = 4800',
      ].join('\n'),
      justUnder: [
        'INVOICE',
        'Invoice Number: INV-9999',
        'Invoice Date: 2026-09-04',
        'Vendor Name: Acme Supplies Co',
        'Currency: USD',
        'Total Amount: 9850',
        '1) Misc supplies 1 x 9850 = 9850',
      ].join('\n'),
      duplicate: [
        'INVOICE',
        'Invoice Number: INV-9001',
        'Invoice Date: 2026-09-01',
        'Vendor Name: Acme Supplies Co',
        'PO Number: PO-1001',
        'Currency: USD',
        'Total Amount: 12500',
      ].join('\n'),
    };

    // Invoices are created by the AP pipeline from sampleTexts (avoids false duplicate hits).
    this.invoices = [];
    this.audits = [];
    this.decisions = [];
    this.exceptions = [];
    this.overrides = [];

    return this.snapshot();
  }

  snapshot(): StoreSnapshot {
    if (!this.tenant || !this.rules) {
      throw new Error('Store not seeded; call seedDemoData() first');
    }
    return {
      tenant: structuredClone(this.tenant),
      entities: structuredClone(this.entities),
      vendors: structuredClone(this.vendors),
      purchaseOrders: structuredClone(this.purchaseOrders),
      invoices: structuredClone(this.invoices),
      users: structuredClone(this.users),
      rules: structuredClone(this.rules),
      audits: structuredClone(this.audits),
      decisions: structuredClone(this.decisions),
      exceptions: structuredClone(this.exceptions),
      overrides: structuredClone(this.overrides),
      sampleTexts: { ...this.sampleTexts },
    };
  }

  async persist(): Promise<string | null> {
    if (!this.dataDir) return null;
    await mkdir(this.dataDir, { recursive: true });
    const filePath = path.join(this.dataDir, 'company-store.json');
    await writeFile(filePath, JSON.stringify(this.snapshot(), null, 2), 'utf8');
    return filePath;
  }

  async load(): Promise<boolean> {
    if (!this.dataDir) return false;
    for (const name of ['company-store.json', 'vern-store.json']) {
      const filePath = path.join(this.dataDir, name);
      try {
        const raw = await readFile(filePath, 'utf8');
        const data = JSON.parse(raw) as StoreSnapshot;
        this.tenant = data.tenant;
        this.entities = data.entities;
        this.vendors = data.vendors;
        this.purchaseOrders = data.purchaseOrders;
        this.invoices = data.invoices;
        this.users = data.users;
        this.rules = data.rules;
        this.audits = data.audits;
        this.decisions = data.decisions;
        this.exceptions = data.exceptions;
        this.overrides = data.overrides;
        this.sampleTexts = data.sampleTexts ?? {};
        this.erp = new NetSuiteStub(data.tenant.id);
        for (const v of data.vendors) this.erp.upsertVendor(v);
        for (const po of data.purchaseOrders) this.erp.upsertPurchaseOrder(po);
        return true;
      } catch {
        // try next filename
      }
    }
    return false;
  }
}
