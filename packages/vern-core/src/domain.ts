/** Shared domain types for VERN AP invoice agent. */

export type UserRole = 'cfo' | 'controller' | 'ap_clerk' | 'auditor';

export type InvoiceStatus =
  | 'draft'
  | 'extracted'
  | 'matched'
  | 'pending_approval'
  | 'auto_posted'
  | 'posted'
  | 'exception'
  | 'rejected'
  | 'overridden';

export type DecisionOutcome =
  | 'auto_post'
  | 'exception_queue'
  | 'require_controller'
  | 'blocked'
  | 'rejected';

export type ConfidenceRoute =
  | 'auto_post'
  | 'exception_queue'
  | 'require_approval';

export interface Tenant {
  id: string;
  name: string;
  createdAt: string;
}

export interface Entity {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  currency: string;
}

export interface Vendor {
  id: string;
  tenantId: string;
  name: string;
  taxId?: string;
  email?: string;
  bankAccountLast4?: string;
  bankChangedAt?: string;
  blocked?: boolean;
  blockReason?: string;
  paymentTerms?: string;
}

export interface PurchaseOrderLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  glAccount?: string;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  entityId: string;
  vendorId: string;
  number: string;
  status: 'open' | 'closed' | 'partial';
  currency: string;
  totalAmount: number;
  lines: PurchaseOrderLine[];
  createdAt: string;
}

export interface InvoiceLine {
  lineNumber: number;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  glAccount?: string;
  poLineNumber?: number;
}

export interface Invoice {
  id: string;
  tenantId: string;
  entityId: string;
  vendorId?: string;
  vendorName?: string;
  poId?: string;
  poNumber?: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  currency: string;
  subtotal: number;
  tax: number;
  totalAmount: number;
  lines: InvoiceLine[];
  status: InvoiceStatus;
  bankAccountLast4?: string;
  sourceDocumentId?: string;
  erpPostingId?: string;
  confidence?: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCallEvidence {
  tool: string;
  inputSummary: string;
  outputSummary: string;
  at: string;
}

export interface Decision {
  id: string;
  tenantId: string;
  invoiceId: string;
  outcome: DecisionOutcome;
  confidence: number;
  route: ConfidenceRoute;
  reasoning: string[];
  fraudSignals: string[];
  guardrailHits: string[];
  toolCalls: ToolCallEvidence[];
  explainText: string;
  createdAt: string;
  actor?: string;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  actorRole?: UserRole;
  at: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface HumanOverride {
  id: string;
  tenantId: string;
  invoiceId?: string;
  who: string;
  whoRole: UserRole;
  why: string;
  before: unknown;
  after: unknown;
  at: string;
  auditEventId: string;
}

export type ExceptionSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ExceptionItem {
  id: string;
  tenantId: string;
  invoiceId: string;
  decisionId: string;
  severity: ExceptionSeverity;
  reasons: string[];
  status: 'open' | 'in_review' | 'resolved' | 'escalated';
  assignedRole?: UserRole;
  createdAt: string;
  resolvedAt?: string;
}

export interface ConfidenceRouteResult {
  confidence: number;
  route: ConfidenceRoute;
  reasons: string[];
  thresholdUsed: number;
}

export interface GuardrailContext {
  tenantId: string;
  actor?: string;
  actorRole?: UserRole;
  approvalAmountLimit: number;
  autoPostThreshold: number;
  blockedVendorIds: string[];
  shortPayTolerance: number;
  matchedVendor?: Vendor;
  matchedPo?: PurchaseOrder;
  previousInvoices?: Invoice[];
}

export interface GuardrailEvaluation {
  allowed: boolean;
  blocked: boolean;
  requireController: boolean;
  hits: string[];
  reasons: string[];
}

export interface ExplainView {
  summary: string;
  reasoning: string[];
  fraudSignals: string[];
  guardrailHits: string[];
  toolCalls: ToolCallEvidence[];
  confidence: number;
  route: ConfidenceRoute;
  outcome: DecisionOutcome;
}
