# ORBIT Sentinel

ORBIT Sentinel is an evidence-first B2B SaaS core for continuous merchant website monitoring, change intelligence, contextual risk signals, human review and explainable ORBIT Health scoring.

The repository contains the public ORBIT website at `/` and the product foundation at `/sentinel`. Sentinel never makes absolute legal determinations. It records observed signals, confidence, evidence, rule context and review history so an authorized team can make a documented decision.

## Architecture

```text
Next.js web app and lightweight API
  ├─ Organization-scoped merchant and review services
  ├─ Scan orchestration and persistent progress
  └─ PostgreSQL via Prisma
             │
             ▼
        Redis / BullMQ
  ┌──────────┼───────────┐
  ▼          ▼           ▼
Crawler   Analysis    Evidence
worker     worker       worker
  └──────────┴───────────┘
             │
             ▼
         PostgreSQL
```

Heavy scan-browser work is isolated in persistent workers. The web service uses Chromium only for authenticated, on-demand PDF report rendering.

## Implemented capabilities

- organization, membership, RBAC, merchant and multi-site data model;
- email/password sign-in with salted scrypt hashes and revocable database sessions;
- full, incremental, quick and targeted scan records;
- real Playwright Chromium rendering;
- bounded safe expansion of public menus, tabs, details, FAQs and product-variation controls;
- homepage, robots, sitemap-index, sitemap and internal-link discovery;
- URL normalization, DNS validation, redirect limits and SSRF protection;
- normalized extraction of structured data, forms, links, controls and technology signals;
- DOM-located H1â€“H6, true navigation, footer, badges, link CTAs, stock, descriptions, variants, images and embedded documents;
- classification using URL and content evidence together;
- product and policy entities with versioned snapshots;
- contextual claim analysis with explicit negation handling and hash-based cache;
- deterministic, contextual and contradiction signals;
- immutable, addressable evidence records for pages, metadata, structured data, public JSON, images, screenshots, public PDFs and read-only checkout states;
- GPT-5.6 Luna agentic review: objective site-map inventory, persisted investigation plan, iterative read-only evidence tools, explicit budgets and inspected-surface coverage;
- composition-preserving multimodal review linking screenshots/regions to visible text, DOM, CTA/link destinations, product/category relationships and commercial prominence;
- platform-neutral product identity from corroborating structured data, SKU, price, CTA, variants, inventory, templates, category relationships and public commerce APIs, with editorial exclusion;
- an independent deterministic verifier for URLs, policies, product identities/counts, SKUs/prices, link destinations, structured data, checkout controls, documents and exact duplicate content;
- priority-based adjudication with a second Luna critic pass for material disagreements;
- a persisted evidence graph grouping adverse, contradictory and mitigating records by unique material risk theme;
- normalized content hashes, historical snapshots and sentence-level smart diff;
- finding review, careful resolution and audit history;
- versioned ruleset schema and seeded baseline rule;
- explainable weighted ORBIT Health score and component deductions;
- BullMQ retry/backoff, dead-letter jobs and worker heartbeats;
- Watchtower, merchant dashboard, findings, products, policies, Evidence Vault, scan history and live progress;
- merchant-scoped client accounts and authenticated, print-ready PDF reports;
- database and Redis health endpoints;
- real local HTTP fixture crawl in the automated test suite.

## Local installation

Requirements: Node.js 20+, Docker with Compose, and npm.

```bash
npm install
copy .env.example .env
docker compose up -d
npm run db:migrate
npm run db:seed
npx playwright install chromium
```

Run the web app and workers in separate terminals:

```bash
npm run dev
npm run workers
```

Open `http://localhost:3000/sentinel`. The seed is visibly marked as a demo workspace and uses only an intentionally invalid demonstration domain. Add a merchant with a publicly reachable HTTP or HTTPS URL to run a real scan.

The seeded owner signs in at `/login` with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. If no password is configured in local development, the seed uses `orbit-demo-change-me`; change it before allowing network access. Owners and administrators can add users from **Users & access**. `VIEWER` is a read-only client role and must be assigned to at least one merchant.

Docker can run the worker group too:

```bash
docker compose --profile workers up -d --build
```

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string for queues, throttling and health checks |
| `APP_URL` | Canonical web origin used by mutation origin checks |
| `AI_PROVIDER` | `deterministic` or `openai-compatible`; the latter enables the Responses API review path |
| `AI_MODEL` | Legacy semantic model identifier used only when dual review is off or shadowed |
| `AI_REVIEW_MODEL` / `AI_CRITIC_MODEL` | Primary holistic reviewer and material-disagreement critic; both default to `gpt-5.6-luna` |
| `AI_REVIEW_REASONING_EFFORT` | Luna reasoning effort for primary and critic passes |
| `DUAL_REVIEW_MODE` | `off`, `shadow`, or `enforced`; enforced gates score eligibility through adjudication |
| `AI_REVIEW_MAX_INPUT_CHARS` / `AI_REVIEW_MAX_RECORDS` | Deterministic evidence-manifest shard bounds |
| `AI_AUDIT_MAX_TIME_MS` / `AI_AUDIT_MAX_TOOL_CALLS` | Merchant-wide Luna investigation time and tool-call budgets |
| `AI_AUDIT_MAX_PAGES` / `AI_AUDIT_MAX_IMAGE_REGIONS` / `AI_AUDIT_MAX_DOCUMENTS` | Inspectable surface budgets; reaching one produces partial, never perfect, coverage |
| `AI_AUDIT_MAX_TOKENS` / `AI_AUDIT_MAX_COST_USD` | Token and estimated-cost ceilings supplied to and enforced around the Luna investigation loop |
| `AI_CRITIC_MAX_DISAGREEMENTS` | Maximum material disagreements sent to one critic pass |
| `AI_API_KEY` | Required server-only credential when the remote semantic layer is enabled |
| `AI_BASE_URL` | OpenAI API base URL; dual review uses `/responses` with strict JSON Schema output |
| `AI_TIMEOUT_MS` | Per semantic request timeout |
| `AI_MAX_PAGE_CHARS` | Maximum retained evidence characters sent per page |
| `AI_MAX_OUTPUT_TOKENS` | Maximum structured output tokens per semantic request |
| `AI_PAGE_CONCURRENCY` | Concurrent page-level semantic requests, capped at eight |
| `AI_VISUAL_MAX_PAGES` | Maximum prominence-ranked pages sent to visual review per scan |
| `AI_VISUAL_MAX_ASSETS_PER_PAGE` | Maximum deduplicated visual assets reviewed per selected page |
| `AI_VISUAL_MAX_IMAGE_BYTES` | Maximum encoded source bytes accepted for one visual asset |
| `AI_DOCUMENT_MAX_FILES` | Maximum public PDFs extracted per scan |
| `AI_DOCUMENT_MAX_PAGES` | Maximum pages extracted from each public PDF |
| `AI_DOCUMENT_MAX_CHARS` | Maximum document characters sent to semantic review |
| `PUBLIC_API_MAX_RESPONSES` | Maximum anonymous same-origin JSON/XHR responses retained per rendered page |
| `CHECKOUT_EXPLORATION_MODE` | `read_only` by default; `anonymous_cart` is reserved for isolated non-ordering exploration |
| `EXTERNAL_VERIFICATION_ENABLED` | Enables separate public-web verification for material merchant claims requested by Luna |
| `EXTERNAL_VERIFICATION_MAX_CLAIMS` | Maximum external claims checked per scan |
| `AI_INPUT_COST_PER_MILLION` | Optional input-token price used for scan cost estimates |
| `AI_OUTPUT_COST_PER_MILLION` | Optional output-token price used for scan cost estimates |
| `AI_VISION_INPUT_COST_PER_MILLION` / `AI_VISION_OUTPUT_COST_PER_MILLION` | Optional vision-model rates; generic rates are the fallback |
| `AI_DOCUMENT_INPUT_COST_PER_MILLION` / `AI_DOCUMENT_OUTPUT_COST_PER_MILLION` | Optional document-model rates; generic rates are the fallback |
| `SCREENSHOT_STORAGE` | Development evidence-storage directory |
| `CRAWLER_MAX_PAGES` | Hard per-scan page limit |
| `CRAWLER_MAX_DEPTH` | Internal-link discovery depth |
| `CRAWLER_CONCURRENCY` | Concurrent pages per site, capped in code |
| `CRAWLER_RESPONSE_LIMIT_BYTES` | Maximum rendered document size |
| `CRAWLER_NAVIGATION_TIMEOUT_MS` | Per-navigation timeout |
| `INTERNAL_JOB_SECRET` | Credential for internal scheduling and initial organization setup |
| `ORBIT_SECRET_ENCRYPTION_KEY` | Base64-encoded 32-byte server key used to encrypt merchant integration secrets at rest |
| `ORBIT_DEMO_MODE` | Marks the local seeded workspace as demonstration data |
| `SESSION_TTL_DAYS` | Lifetime of revocable login sessions |
| `SEED_ADMIN_EMAIL` | Initial owner email used by the seed |
| `SEED_ADMIN_PASSWORD` | Initial owner password; set a unique secret before deployment |

Never expose server variables through `NEXT_PUBLIC_*`.

## Scan lifecycle

1. The API validates organization access, role, merchant ownership and scan mode.
2. A `QUEUED` scan and persistent progress record are created.
3. BullMQ sends the scan to the crawler worker.
4. The crawler validates DNS and every navigation target, discovers public URLs, renders pages and stores normalized snapshots.
5. The analysis worker retains a first-party evidence ledger, extracts images and public PDFs, and builds one versioned evidence manifest.
6. GPT-5.6 Luna reviews that manifest holistically while the independent verifier derives objective assertions from the same records.
7. Deterministic adjudication gives Luna priority for meaning and context, gives the verifier priority for objective facts, invokes a second critic for material conflicts, and marks unresolved conflicts `NEEDS_REVIEW` with `scoreEligible=false`.
8. Only adjudicated, validated structured evidence reaches the deterministic ORBIT Health Score. Luna never receives or calculates the score.
9. The frontend polls persisted job state. Authorized audit clients can read `/api/sentinel/scans/:scanId/evidence` and `/api/sentinel/scans/:scanId/review`.

Jobs use exponential retry. Exhausted jobs enter a dead-letter queue and mark their scan failed. Worker liveness is stored in `WorkerHeartbeat`.

### Continuous monitoring

`POST /api/internal/sentinel/schedule` enqueues due incremental scans. It requires `Authorization: Bearer <INTERNAL_JOB_SECRET>`. Invoke it from a trusted scheduler no more frequently than hourly. Site cadence has a 60-minute minimum.

## Queue layout

- `sentinel-pipeline-v2-crawler`: discovery, rendering and snapshots;
- `sentinel-pipeline-v2-analysis`: extraction, rules, contradictions, reconciliation and scoring;
- `sentinel-pipeline-v2-evidence`: selective screenshots;
- `sentinel-pipeline-v2-dead-letter`: terminal failures with original job context.

## Rules engine

Rules use `RuleSet → Rule → RuleVersion`. A version stores severity, evaluation type, applicability, effective dates, remediation guidance and optional source metadata. A finding can reference the exact version that produced it.

To add a ruleset or rule:

1. create a `RuleSet` with a stable code and integer version;
2. add stable `Rule.key` identifiers;
3. add immutable `RuleVersion` records instead of overwriting history;
4. implement a pure evaluator under `src/sentinel/analysis`;
5. return a `CandidateFinding` with evidence-oriented, non-absolute wording;
6. add positive, negative and negation tests.

Deterministic checks run first. A keyword can nominate a statement for contextual review, but a keyword by itself does not become a finding.

## Dual review

In enforced mode, GPT-5.6 Luna is the primary semantic and contextual reviewer. It receives bounded deterministic shards when a manifest exceeds input limits, then performs merchant-wide synthesis. Every summary, uncertainty and observation must cite retained first-party `EvidenceRecord` IDs. ORBIT hydrates the actual text, value, URL or stored asset after the response; invented or external IDs are rejected. Luna returns only `ADVERSE`, `MITIGATING`, `NEUTRAL` or `INFORMATIONAL` observations and never returns merchant approval, legality, processor eligibility or an ORBIT score.

The deterministic verifier independently derives objective `VerificationAssertion` records from the evidence ledger. `AdjudicationDecision` records make the authority explicit: semantic/context questions prioritize Luna, objective facts prioritize the verifier, material conflicts can trigger a separate critic `ReviewRun`, and unresolved conflicts are retained as `NEEDS_REVIEW` but excluded from score deductions.

Optional public-web verification runs only for material claim requests emitted by Luna. Search results must be cited by the provider and independently retrievable by ORBIT before they are retained. Those artifacts use the `EXTERNAL_PUBLIC_WEB` scope and are never mixed into the first-party merchant manifest.

The older page, visual and document semantic analyzers remain available in `off` and `shadow` modes for migration comparison. Enforced mode reuses their collection and extraction components but disables their model judgments so Luna remains primary.

## Finding lifecycle

Findings are fingerprinted by rule and evidence-bearing text, with site-wide identities for template-duplicated and semantic evidence. A repeated signal updates `lastDetectedAt`, retains affected URLs and appends evidence instead of replacing history. Dual-review findings link to both their `AdjudicationDecision` and retained `EvidenceRecord` rows. During a complete scan, a disappeared signal becomes `RESOLVED` with `resolvedAt` and `resolvedByScanId`; it is never deleted. Reviewer decisions create both a `FindingReview` and an append-only `AuditLog` record.

## Score engine

`orbit-health-v9` applies deterministic deductions once per unique material risk theme. Severity is adjusted by coded prominence, validated confidence and bounded mitigating controls; repeated template or page evidence remains auditable but cannot multiply the deduction. Coverage is stored separately, and incomplete semantic, visual, document or checkout inspection lowers assessment certainty rather than silently passing. Candidates with `scoreEligible=false` are filtered before scoring. LLMs never calculate or decide the score.

## Security model

- targets are limited to HTTP and HTTPS;
- localhost, internal hostnames, private ranges, link-local addresses, metadata targets, URL credentials and reserved networks are blocked;
- DNS is resolved before requests and every browser resource/navigation is revalidated;
- redirects, response size, depth, page count, concurrency and navigation time are bounded;
- only public pages are rendered; there is no authentication, CAPTCHA or anti-bot bypass;
- all data queries include organization scope, and client roles are additionally constrained by explicit merchant grants;
- login passwords use salted scrypt hashes and session cookies are `HttpOnly`, `SameSite=Lax` and `Secure` in production;
- raw session tokens never enter the database; only SHA-256 token hashes are stored;
- mutations require an allowed membership role;
- same-origin mutation checks, Zod validation and Redis request limits are applied;
- evidence storage prevents path traversal and is abstracted behind `EvidenceStorage`;
- external HTML is parsed into normalized data and is never rendered into the UI;
- secrets remain server-side and operational mutations append audit records.

Organization context is derived from the authenticated database session. Clients cannot select organization or user identifiers through request headers.

## Health endpoints

- `GET /api/health`
- `GET /api/health/database`
- `GET /api/health/redis`

## Tests and validation

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Tests cover SSRF primitives, extraction, classification, semantic negation, scoring, smart diff and a real Playwright crawl against an ephemeral local HTTP fixture. The private-network crawler override is guarded by `NODE_ENV=test` and cannot run in normal environments.

## Deployment

Deploy the Next.js app with external PostgreSQL and Redis. Deploy `Dockerfile.worker` on a persistent container host that supports Chromium. Apply committed migrations before traffic:

```bash
npx prisma migrate deploy
```

Scale crawler workers conservatively because each job owns browser contexts. Analysis and evidence workers scale independently. Implement shared object storage behind `EvidenceStorage` before using multiple evidence hosts.

### Coolify

Create two resources in the same Coolify project and network as the application: **PostgreSQL** and **Redis**. Use their internal connection URLs in `DATABASE_URL` and `REDIS_URL`; the database ports do not need to be publicly exposed. Set `APP_URL` to the exact public HTTPS origin of ORBIT.

Before the first sign-in, configure a unique `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`, then run:

```bash
npx prisma migrate deploy
npm run db:seed
```

Open `/login`. The seeded account is the workspace owner. It can add administrators, analysts, reviewers and merchant-scoped client users from **Users & access**. A client with one assignment lands directly on that merchant report and can download the authenticated PDF. Every user can rotate their own password from **Profile & security**. Keep `ORBIT_DEMO_MODE=false` for a real workspace.

For an initial VPS deployment, install Docker and run the PostgreSQL/Redis services plus the `workers` profile. The development Compose file binds database ports only to `127.0.0.1`; do not publish ports `5432` or `6379` to the internet. Put the web app behind HTTPS, replace every development credential, restrict firewall ingress, configure encrypted database backups and monitor disk usage for evidence retention. A managed PostgreSQL service is preferable once the system holds operational data.

## Known limitations

- email delivery, password recovery and multi-factor authentication require an external transactional-email and identity workflow;
- the local contextual analyzer is intentionally narrow and should be extended with reviewed, versioned domain evaluators;
- local evidence storage is development-only for multi-host deployments;
- robots matching supports common directives but not every wildcard edge case;
- scheduling requires a trusted hourly trigger;
- policies and findings remain review signals, not legal advice or certification.
