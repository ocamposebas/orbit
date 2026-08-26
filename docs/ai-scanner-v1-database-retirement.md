# AI Scanner v1 legacy database retirement proposal

No destructive database migration is part of the AI Scanner v1 replacement. The additive migration leaves existing rows and tables recoverable from the pre-refactor application and the Git tag `pre-ai-scanner-v1-20260826`.

The following legacy scanner-only models/tables are proposed for removal in a separate, explicitly reviewed migration after retention/export requirements are confirmed:

- `Scan`, `ScanPage`, `PageSnapshot`, `PageChange`;
- `Product`, `ProductVariant`, `ProductSnapshot`;
- `Policy`, `PolicySnapshot`;
- `RuleSet`, `Rule`, `RuleVersion`;
- `Finding`, `FindingEvidence`, `FindingReview`, `Remediation`;
- `HealthScore`, `HealthScoreComponent`;
- `SemanticAnalysis`;
- `EvidenceArtifact`, `EvidenceRecord`;
- `ReviewRun`, `ReviewObservation`, `ReviewEvidenceLink`;
- `VerificationAssertion`, `VerificationEvidenceLink`;
- `AdjudicationDecision`.

Associated legacy scanner enum values and the old `AuditLog.scanId` relation are also proposed for later retirement. `MerchantSite`, `AuditLog`, `WorkerHeartbeat`, `Alert`, merchant/payment/Stripe/Relay/user/workspace models, PostgreSQL infrastructure, and Redis infrastructure are not proposed for removal.

Before a future drop migration:

1. export or expire legacy scanner rows according to workspace retention settings;
2. verify no non-scanner query, foreign key, report, or audit requirement depends on them;
3. take a production database snapshot;
4. generate and review explicit SQL targets;
5. schedule the destructive migration separately with rollback/recovery instructions.
