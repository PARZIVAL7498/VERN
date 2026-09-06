import type { Invoice, PurchaseOrder, Vendor } from '../domain.js';

export interface ErpHealth {
  ok: boolean;
  name: string;
  latencyMs: number;
  message?: string;
}

export interface ErpPostResult {
  postingId: string;
  status: 'posted' | 'rejected';
  message: string;
  postedAt: string;
}

export interface ErpConnector {
  readonly name: string;
  getVendor(vendorId: string): Promise<Vendor | undefined>;
  getPurchaseOrder(poId: string): Promise<PurchaseOrder | undefined>;
  postInvoice(invoice: Invoice): Promise<ErpPostResult>;
  health(): Promise<ErpHealth>;
}

interface StubSeed {
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
}

abstract class InMemoryErpStub implements ErpConnector {
  abstract readonly name: string;
  protected vendors = new Map<string, Vendor>();
  protected purchaseOrders = new Map<string, PurchaseOrder>();
  protected postings: Array<{ postingId: string; invoiceId: string; at: string }> = [];

  protected loadSeed(seed: StubSeed): void {
    for (const v of seed.vendors) this.vendors.set(v.id, structuredClone(v));
    for (const po of seed.purchaseOrders) this.purchaseOrders.set(po.id, structuredClone(po));
  }

  async getVendor(vendorId: string): Promise<Vendor | undefined> {
    return this.vendors.get(vendorId) ? structuredClone(this.vendors.get(vendorId)!) : undefined;
  }

  async getPurchaseOrder(poId: string): Promise<PurchaseOrder | undefined> {
    return this.purchaseOrders.get(poId)
      ? structuredClone(this.purchaseOrders.get(poId)!)
      : undefined;
  }

  findVendorByName(name: string): Vendor | undefined {
    const needle = name.trim().toLowerCase();
    for (const v of this.vendors.values()) {
      if (v.name.toLowerCase() === needle) return structuredClone(v);
    }
    return undefined;
  }

  findPoByNumber(number: string): PurchaseOrder | undefined {
    const needle = number.trim().toLowerCase();
    for (const po of this.purchaseOrders.values()) {
      if (po.number.toLowerCase() === needle) return structuredClone(po);
    }
    return undefined;
  }

  async postInvoice(invoice: Invoice): Promise<ErpPostResult> {
    if (!invoice.vendorId) {
      return {
        postingId: '',
        status: 'rejected',
        message: 'Missing vendorId',
        postedAt: new Date().toISOString(),
      };
    }
    const vendor = this.vendors.get(invoice.vendorId);
    if (!vendor) {
      return {
        postingId: '',
        status: 'rejected',
        message: `Unknown vendor ${invoice.vendorId}`,
        postedAt: new Date().toISOString(),
      };
    }
    if (vendor.blocked) {
      return {
        postingId: '',
        status: 'rejected',
        message: `Vendor blocked: ${vendor.blockReason ?? 'policy'}`,
        postedAt: new Date().toISOString(),
      };
    }
    const postingId = `${this.name.toLowerCase()}-post-${Date.now()}-${this.postings.length + 1}`;
    const postedAt = new Date().toISOString();
    this.postings.push({ postingId, invoiceId: invoice.id, at: postedAt });
    return {
      postingId,
      status: 'posted',
      message: `Posted to ${this.name}`,
      postedAt,
    };
  }

  async health(): Promise<ErpHealth> {
    return {
      ok: true,
      name: this.name,
      latencyMs: 1,
      message: 'stub healthy',
    };
  }

  listVendors(): Vendor[] {
    return [...this.vendors.values()].map((v) => structuredClone(v));
  }

  listPurchaseOrders(): PurchaseOrder[] {
    return [...this.purchaseOrders.values()].map((po) => structuredClone(po));
  }

  upsertVendor(vendor: Vendor): void {
    this.vendors.set(vendor.id, structuredClone(vendor));
  }

  upsertPurchaseOrder(po: PurchaseOrder): void {
    this.purchaseOrders.set(po.id, structuredClone(po));
  }
}

function defaultSeed(tenantId: string, prefix: string): StubSeed {
  const vendors: Vendor[] = [
    {
      id: `${prefix}-vendor-acme-supplies`,
      tenantId,
      name: 'Acme Supplies Co',
      taxId: '12-3456789',
      email: 'ap@acmesupplies.example',
      bankAccountLast4: '4412',
      paymentTerms: 'Net 30',
    },
    {
      id: `${prefix}-vendor-blocked`,
      tenantId,
      name: 'Shadow Logistics LLC',
      taxId: '98-7654321',
      email: 'billing@shadowlog.example',
      bankAccountLast4: '9999',
      blocked: true,
      blockReason: 'OFAC / sanctions review',
      paymentTerms: 'Net 15',
    },
    {
      id: `${prefix}-vendor-bank-change`,
      tenantId,
      name: 'Northwind Paper',
      taxId: '45-1122334',
      email: 'ar@northwind.example',
      bankAccountLast4: '7788',
      bankChangedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      paymentTerms: 'Net 45',
    },
  ];

  const purchaseOrders: PurchaseOrder[] = [
    {
      id: `${prefix}-po-1001`,
      tenantId,
      entityId: `${tenantId}-entity-hq`,
      vendorId: vendors[0]!.id,
      number: 'PO-1001',
      status: 'open',
      currency: 'USD',
      totalAmount: 12500,
      createdAt: new Date().toISOString(),
      lines: [
        {
          lineNumber: 1,
          description: 'Office paper reams',
          quantity: 500,
          unitPrice: 20,
          amount: 10000,
          glAccount: '6100',
        },
        {
          lineNumber: 2,
          description: 'Shipping',
          quantity: 1,
          unitPrice: 2500,
          amount: 2500,
          glAccount: '6200',
        },
      ],
    },
    {
      id: `${prefix}-po-1003`,
      tenantId,
      entityId: `${tenantId}-entity-hq`,
      vendorId: vendors[0]!.id,
      number: 'PO-1003',
      status: 'open',
      currency: 'USD',
      totalAmount: 4500,
      createdAt: new Date().toISOString(),
      lines: [
        {
          lineNumber: 1,
          description: 'Office paper reams',
          quantity: 225,
          unitPrice: 20,
          amount: 4500,
          glAccount: '6100',
        },
      ],
    },
    {
      id: `${prefix}-po-1002`,
      tenantId,
      entityId: `${tenantId}-entity-hq`,
      vendorId: vendors[2]!.id,
      number: 'PO-1002',
      status: 'open',
      currency: 'USD',
      totalAmount: 4800,
      createdAt: new Date().toISOString(),
      lines: [
        {
          lineNumber: 1,
          description: 'Specialty paper',
          quantity: 200,
          unitPrice: 24,
          amount: 4800,
          glAccount: '6100',
        },
      ],
    },
  ];

  return { vendors, purchaseOrders };
}

export class NetSuiteStub extends InMemoryErpStub {
  readonly name = 'NetSuite';
  constructor(tenantId = 'acme-corp') {
    super();
    this.loadSeed(defaultSeed(tenantId, 'ns'));
  }
}

export class SapStub extends InMemoryErpStub {
  readonly name = 'SAP';
  constructor(tenantId = 'acme-corp') {
    super();
    this.loadSeed(defaultSeed(tenantId, 'sap'));
  }
}

export class WorkdayStub extends InMemoryErpStub {
  readonly name = 'Workday';
  constructor(tenantId = 'acme-corp') {
    super();
    this.loadSeed(defaultSeed(tenantId, 'wd'));
  }
}

export class DynamicsStub extends InMemoryErpStub {
  readonly name = 'Dynamics';
  constructor(tenantId = 'acme-corp') {
    super();
    this.loadSeed(defaultSeed(tenantId, 'dyn'));
  }
}

export type KnownErpStub = NetSuiteStub | SapStub | WorkdayStub | DynamicsStub;

export function createErpStub(
  system: 'netsuite' | 'sap' | 'workday' | 'dynamics',
  tenantId = 'acme-corp',
): KnownErpStub {
  switch (system) {
    case 'netsuite':
      return new NetSuiteStub(tenantId);
    case 'sap':
      return new SapStub(tenantId);
    case 'workday':
      return new WorkdayStub(tenantId);
    case 'dynamics':
      return new DynamicsStub(tenantId);
  }
}
