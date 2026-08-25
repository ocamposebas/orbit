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
- homepage, robots, sitemap-index, sitemap and internal-link discovery;
- URL normalization, DNS validation, redirect limits and SSRF protection;
- normalized extraction of structured data, forms, links, controls and technology signals;
- classification using URL and content evidence together;
- product and policy entities with versioned snapshots;
- contextual claim analysis with explicit negation handling and hash-based cache;
- deterministic, contextual and contradiction signals;
- immutable evidence records and selective high-severity screenshots;
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
| `AI_PROVIDER` | `deterministic` or `openai-compatible`; the latter enables both page and merchant LLM passes |
| `AI_MODEL` | Provider model identifier recorded with semantic evidence |
| `AI_API_KEY` | Required server-only credential when the remote semantic layer is enabled |
| `AI_BASE_URL` | OpenAI-compatible API base URL; requests use `/chat/completions` with strict JSON Schema output |
| `AI_TIMEOUT_MS` | Per semantic request timeout |
| `AI_MAX_PAGE_CHARS` | Maximum retained evidence characters sent per page |
| `AI_MAX_OUTPUT_TOKENS` | Maximum structured output tokens per semantic request |
| `AI_PAGE_CONCURRENCY` | Concurrent page-level semantic requests, capped at eight |
| `AI_INPUT_COST_PER_MILLION` | Optional input-token price used for scan cost estimates |
| `AI_OUTPUT_COST_PER_MILLION` | Optional output-token price used for scan cost estimates |
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
5. The analysis worker extracts products and policies, evaluates inexpensive rules, sends only candidate statements to contextual analysis, reconciles findings and calculates the score.
6. High and critical findings are sent to the evidence worker for a selective screenshot.
7. The frontend polls a lightweight endpoint and renders only persisted job state.

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

## Semantic analyzer

Sentinel is hybrid. The deterministic rule engine runs first and remains active for every scan. When `AI_PROVIDER=openai-compatible`, a second engine sends bounded, typed page evidence to an LLM using temperature zero and strict JSON Schema output. Page results classify intended use, human outcomes, research positioning, contradictions, disclaimers, pharmacy/prescription context, dosing, medical claims, qualification and checkout controls, policy coverage, and inconsistent positioning.

LLM output is parsed with strict Zod schemas and rejected unless each exact evidence quote, URL and evidence type can be matched to the retained page input. Negations and controls remain observations but do not become risk findings. Validated risk observations are converted to `NEEDS_REVIEW` candidates; the LLM never receives or returns an approval or certification decision.

A second merchant-level pass compares validated page observations and deterministic findings. It must cite a primary item and at least one supporting item, enabling auditable RUO-versus-commercial-positioning contradictions. Deterministic findings shadow equivalent semantic observations, repeated semantic evidence is consolidated across templates, and distinct supported observations remain separate.

`SemanticAnalyzer` continues to provide local claim-level context. `WebsiteSemanticAnalyzer` provides the structured remote page and merchant passes. Both caches use content hash, prompt version, provider and model. Cache rows store structured results and request usage only—never hidden reasoning traces or credentials.

Cost estimates are written to `scan.completed` audit metadata when per-million-token rates are configured. The estimate is `input tokens × AI_INPUT_COST_PER_MILLION / 1,000,000 + output tokens × AI_OUTPUT_COST_PER_MILLION / 1,000,000`; cache hits have zero incremental estimated cost.

## Finding lifecycle

Findings are fingerprinted by rule and evidence-bearing text, with site-wide identities for template-duplicated and semantic evidence. A repeated signal updates `lastDetectedAt`, retains affected URLs and appends evidence instead of replacing history. Semantic evidence metadata records source layer, evidence type, human-review requirement, provider, model, prompt version and confidence, and links to the immutable page snapshot. During a complete scan, a disappeared signal becomes `RESOLVED` with `resolvedAt` and `resolvedByScanId`; it is never deleted. Reviewer decisions create both a `FindingReview` and an append-only `AuditLog` record.

## Score engine

`orbit-health-v6` starts each component at 100 and applies disclosed per-finding deductions. Only semantic observations that pass schema, exact-evidence, confidence and human-review gates enter the existing candidate-quality and deterministic score pipeline. Deterministic findings remain authoritative when the same evidence is observed by both layers. The total is a fixed weighted sum. Stored scores include formula version, weights, component results and each deduction. ORBIT Health is an internal decision-support measure, not a legal conclusion or external approval metric.

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
