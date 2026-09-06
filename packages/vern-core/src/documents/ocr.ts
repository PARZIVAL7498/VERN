import type { Invoice, InvoiceLine } from '../domain.js';

export interface ExtractedInvoiceDraft {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  vendorName: string;
  vendorId?: string;
  poNumber?: string;
  currency: string;
  subtotal: number;
  tax: number;
  totalAmount: number;
  bankAccountLast4?: string;
  lines: InvoiceLine[];
  rawText?: string;
  extractionMethod: 'pdf_text' | 'sample_text' | 'structured_fallback';
  warnings: string[];
}

export interface StructuredInvoiceFallback {
  invoiceNumber: string;
  invoiceDate?: string;
  dueDate?: string;
  vendorName: string;
  vendorId?: string;
  poNumber?: string;
  currency?: string;
  subtotal?: number;
  tax?: number;
  totalAmount: number;
  bankAccountLast4?: string;
  lines?: InvoiceLine[];
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseMoney(raw: string): number | undefined {
  const cleaned = raw.replace(/[$,]/g, '').trim();
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? money(n) : undefined;
}

function field(text: string, label: RegExp): string | undefined {
  const m = text.match(label);
  return m?.[1]?.trim();
}

function parseLinesFromText(text: string): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  const lineRe =
    /(?:^|\n)\s*(?:line\s*)?(\d+)[.)\t ]+(.+?)\s+(\d+(?:\.\d+)?)\s+[xX@]\s*\$?([\d,]+(?:\.\d+)?)\s*=?\s*\$?([\d,]+(?:\.\d+)?)/gim;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(text)) !== null) {
    const quantity = Number(match[3]);
    const unitPrice = parseMoney(match[4]!) ?? 0;
    const amount = parseMoney(match[5]!) ?? money(quantity * unitPrice);
    lines.push({
      lineNumber: Number(match[1]),
      description: match[2]!.trim(),
      quantity,
      unitPrice,
      amount,
    });
  }
  return lines;
}

function bufferToText(input: Buffer | string): string {
  if (typeof input === 'string') return input;
  // Demo: treat PDF-ish buffers as UTF-8 text (seed PDFs are text payloads).
  const asUtf8 = input.toString('utf8');
  if (asUtf8.includes('Invoice') || asUtf8.includes('INVOICE') || asUtf8.includes('vendor')) {
    return asUtf8;
  }
  // Strip crude PDF stream noise when present
  return asUtf8
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDraftFromText(
  text: string,
  method: ExtractedInvoiceDraft['extractionMethod'],
): ExtractedInvoiceDraft {
  const warnings: string[] = [];
  const invoiceNumber =
    field(text, /invoice\s*(?:number|#|no\.?)\s*[:#]?\s*([A-Z0-9-]+)/i) ??
    `INV-EXTRACT-${Date.now()}`;
  if (!field(text, /invoice\s*(?:number|#|no\.?)\s*[:#]?\s*([A-Z0-9-]+)/i)) {
    warnings.push('invoiceNumber inferred');
  }

  const invoiceDate =
    field(text, /invoice\s*date\s*[:#]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i) ??
    new Date().toISOString().slice(0, 10);
  const dueDate = field(
    text,
    /due\s*date\s*[:#]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i,
  );
  const vendorName =
    field(text, /vendor\s*(?:name)?\s*[:#]?\s*(.+)$/im) ??
    field(text, /bill\s*from\s*[:#]?\s*(.+)$/im) ??
    'Unknown Vendor';
  if (vendorName === 'Unknown Vendor') warnings.push('vendorName missing');

  const poNumber = field(text, /(?:po|purchase\s*order)\s*(?:number|#|no\.?)?\s*[:#]?\s*([A-Z0-9-]+)/i);
  const currency = field(text, /currency\s*[:#]?\s*([A-Z]{3})/i) ?? 'USD';
  const tax = parseMoney(field(text, /(?:^|\n)\s*tax\s*[:#]?\s*\$?([\d,]+(?:\.\d+)?)/im) ?? '') ?? 0;
  // Avoid matching "Subtotal" — require Total / Total Amount / Amount Due
  let totalAmount =
    parseMoney(
      field(
        text,
        /(?:^|\n)\s*(?:total\s*(?:amount|due)?|amount\s*due)\s*[:#]?\s*\$?([\d,]+(?:\.\d+)?)/im,
      ) ?? '',
    ) ?? 0;
  let subtotal =
    parseMoney(field(text, /sub[\s-]?total\s*[:#]?\s*\$?([\d,]+(?:\.\d+)?)/i) ?? '') ?? 0;
  if (!totalAmount && subtotal) totalAmount = money(subtotal + tax);
  if (!subtotal && totalAmount) subtotal = money(totalAmount - tax);
  const bankAccountLast4 = field(text, /(?:bank|account).*?(\d{4})\b/i);
  const lines = parseLinesFromText(text);
  if (lines.length === 0 && totalAmount > 0) {
    lines.push({
      lineNumber: 1,
      description: 'Extracted line',
      quantity: 1,
      unitPrice: totalAmount,
      amount: totalAmount,
    });
    warnings.push('synthetic single line from total');
  }

  return {
    invoiceNumber,
    invoiceDate,
    ...(dueDate ? { dueDate } : {}),
    vendorName: vendorName.trim(),
    ...(poNumber ? { poNumber } : {}),
    currency,
    subtotal: money(subtotal),
    tax: money(tax),
    totalAmount: money(totalAmount),
    ...(bankAccountLast4 ? { bankAccountLast4 } : {}),
    lines,
    rawText: text.slice(0, 4000),
    extractionMethod: method,
    warnings,
  };
}

/** Demo OCR: parse text/PDF-ish content or accept structured fallback. */
export function extractInvoiceFromPdf(
  input: Buffer | string | StructuredInvoiceFallback,
): ExtractedInvoiceDraft {
  if (typeof input === 'object' && input !== null && !Buffer.isBuffer(input) && 'invoiceNumber' in input) {
    const s = input as StructuredInvoiceFallback;
    const total = money(s.totalAmount);
    const lines =
      s.lines && s.lines.length > 0
        ? s.lines
        : [
            {
              lineNumber: 1,
              description: 'Structured fallback line',
              quantity: 1,
              unitPrice: total,
              amount: total,
            },
          ];
    return {
      invoiceNumber: s.invoiceNumber,
      invoiceDate: s.invoiceDate ?? new Date().toISOString().slice(0, 10),
      ...(s.dueDate ? { dueDate: s.dueDate } : {}),
      vendorName: s.vendorName,
      ...(s.vendorId ? { vendorId: s.vendorId } : {}),
      ...(s.poNumber ? { poNumber: s.poNumber } : {}),
      currency: s.currency ?? 'USD',
      subtotal: money(s.subtotal ?? total),
      tax: money(s.tax ?? 0),
      totalAmount: total,
      ...(s.bankAccountLast4 ? { bankAccountLast4: s.bankAccountLast4 } : {}),
      lines,
      extractionMethod: 'structured_fallback',
      warnings: ['used structured fallback'],
    };
  }

  const text = bufferToText(input as Buffer | string);
  return buildDraftFromText(text, 'pdf_text');
}

/** Parse seeded invoice sample text into a draft. */
export function extractFromSampleText(text: string): ExtractedInvoiceDraft {
  return buildDraftFromText(text, 'sample_text');
}

export function draftToPartialInvoice(
  draft: ExtractedInvoiceDraft,
  ids: { id: string; tenantId: string; entityId: string },
): Omit<Invoice, 'status'> & { status?: Invoice['status'] } {
  const now = new Date().toISOString();
  return {
    id: ids.id,
    tenantId: ids.tenantId,
    entityId: ids.entityId,
    ...(draft.vendorId ? { vendorId: draft.vendorId } : {}),
    vendorName: draft.vendorName,
    ...(draft.poNumber ? { poNumber: draft.poNumber } : {}),
    invoiceNumber: draft.invoiceNumber,
    invoiceDate: draft.invoiceDate,
    ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
    currency: draft.currency,
    subtotal: draft.subtotal,
    tax: draft.tax,
    totalAmount: draft.totalAmount,
    lines: draft.lines,
    ...(draft.bankAccountLast4 ? { bankAccountLast4: draft.bankAccountLast4 } : {}),
    createdAt: now,
    updatedAt: now,
    metadata: {
      extractionMethod: draft.extractionMethod,
      warnings: draft.warnings,
    },
  };
}
