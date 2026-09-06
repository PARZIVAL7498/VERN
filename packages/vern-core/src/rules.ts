export interface TenantRules {
  tenantId: string;
  autoPostThreshold: number;
  approvalAmountLimit: number;
  blockedVendorIds: string[];
  shortPayTolerance: number;
  updatedAt: string;
}

export function defaultTenantRules(tenantId: string): TenantRules {
  return {
    tenantId,
    autoPostThreshold: 0.85,
    approvalAmountLimit: 10000,
    blockedVendorIds: [],
    shortPayTolerance: 50,
    updatedAt: new Date().toISOString(),
  };
}

/** Apply a partial human override onto tenant rules (immutable return). */
export function applyOverrideToRules(
  current: TenantRules,
  patch: Partial<
    Pick<
      TenantRules,
      'autoPostThreshold' | 'approvalAmountLimit' | 'blockedVendorIds' | 'shortPayTolerance'
    >
  >,
): TenantRules {
  return {
    ...current,
    ...(patch.autoPostThreshold !== undefined
      ? { autoPostThreshold: clamp(patch.autoPostThreshold, 0, 1) }
      : {}),
    ...(patch.approvalAmountLimit !== undefined
      ? { approvalAmountLimit: Math.max(0, patch.approvalAmountLimit) }
      : {}),
    ...(patch.blockedVendorIds !== undefined
      ? { blockedVendorIds: [...new Set(patch.blockedVendorIds)] }
      : {}),
    ...(patch.shortPayTolerance !== undefined
      ? { shortPayTolerance: Math.max(0, patch.shortPayTolerance) }
      : {}),
    updatedAt: new Date().toISOString(),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
