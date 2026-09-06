const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

export type VernRole = 'cfo' | 'controller' | 'ap_clerk' | 'auditor';

export function apiUrl(path: string): string {
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { role?: VernRole; userId?: string },
): Promise<T> {
  const { role = 'controller', userId, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  headers.set('x-vern-role', role);
  headers.set('x-vern-user-id', userId ?? defaultUserForRole(role));
  if (rest.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const res = await fetch(apiUrl(path), { ...rest, headers, cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function defaultUserForRole(role: VernRole): string {
  switch (role) {
    case 'cfo':
      return 'user-cfo';
    case 'ap_clerk':
      return 'user-ap';
    case 'auditor':
      return 'user-auditor';
    default:
      return 'user-controller';
  }
}

export interface CfoDashboard {
  invoiceCount: number;
  totalSpend: number;
  autoPostedCount: number;
  autoPostedAmount: number;
  exceptionCount: number;
  openExceptions: number;
  criticalExceptions: number;
  blockedOrRejected: number;
  avgConfidence: number | null;
  autoPostRate: number;
  exceptionRate: number;
  spendByVendor: Array<{ vendorId: string; vendorName: string; amount: number; count: number }>;
  topExceptionReasons: Array<{ reason: string; count: number }>;
  generatedAt: string;
}

export interface ExceptionItem {
  id: string;
  invoiceId: string;
  severity: string;
  reasons: string[];
  status: string;
  assignedRole?: string;
  createdAt: string;
}

export interface JudgmentCard {
  exceptionId: string;
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  amount: number;
  currency: string;
  severity: string;
  reasons: string[];
  fraudChips: string[];
  guardrailChips: string[];
  recommendedAction: string;
  recommendationRationale: string;
  policyLearnPreview: string[];
  sod: {
    apClerkCanApprove: boolean;
    requiresController: boolean;
    requiresCfo: boolean;
    message: string;
  };
  riskSummary: string;
}

export interface ExplainPayload {
  invoice: {
    id: string;
    invoiceNumber: string;
    vendorName?: string;
    totalAmount: number;
    status: string;
    currency: string;
    confidence?: number;
  };
  explain: {
    summary: string;
    reasoning: string[];
    fraudSignals: string[];
    guardrailHits: string[];
    confidence: number;
    route: string;
    outcome: string;
    toolCalls?: Array<{ tool: string; inputSummary: string; outputSummary: string }>;
  };
}
