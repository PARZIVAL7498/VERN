'use client';

import { apiUrl } from '@/lib/api';

export default function AuditPage() {
  return (
    <main>
      <h1 className="rise">Audit export</h1>
      <p className="lede rise-delay">
        Download the immutable audit trail — process decisions, human overrides, and exception
        actions for Acme Corp.
      </p>
      <a className="btn" href={apiUrl('/v1/audit/export')} download>
        Download audit JSON
      </a>
    </main>
  );
}
