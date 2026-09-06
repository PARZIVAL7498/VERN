# How judgment + policy learn work

## Judgment (exception review desk)

1. **Extract** invoice text/PDF → structured fields (vendor, PO, amount, bank last4).
2. **Match** against ERP stubs (vendor + PO) and score confidence.
3. **Hard guardrails** run server-side (`HardGuardrailPolicy`) — blocked vendors, amount limits, PO variance, SoD. The Assist LLM cannot disable these.
4. **Route:** high confidence + clean guardrails → auto-post; otherwise → exception queue with reasons.
5. **Judgment card** (`buildJudgmentCard`) surfaces risk summary, fraud/guardrail chips, recommended action, SoD message, and a **policy-learn preview** of what approving would change.

## Segregation of duties

- `ap_clerk` cannot approve controller-gated or blocked exceptions (API returns `403 sod_violation`).
- Blocked vendors require **CFO** override.
- Auditors are read-only on approve/reject.

## Policy learn (Improve)

On **approve**, `learnFromHumanDecision` may nudge tenant rules:

- Just-under-threshold approve → raise `approvalAmountLimit`
- Short-pay / PO variance approve → raise `shortPayTolerance`

On **reject** of duplicates, thresholds stay tight. **Blocked vendor lists are never auto-cleared.**

Every override and policy learn writes an audit event (`policy_learn`, approve/reject) exportable via `GET /v1/audit/export`.
