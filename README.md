# ORBIT

ORBIT combines merchant operations, Stripe Connect, payments, WooCommerce Relay, and a Luna-first website audit called **ORBIT AI Scanner v1**. The application UI remains at `/sentinel` for route compatibility; the scanner runtime itself is independent under `src/ai-scanner`.

## AI Scanner v1 architecture

```text
Merchant URL
  → POST /api/ai-scanner/scans
  → BullMQ: orbit-ai-scanner-v1
  → GPT-5.6 Luna audit session
  → Luna-selected read-only Playwright tools
  → retained first-party text, DOM, structured data, documents and pixels
  → objective evidence/SKU/product validation
  → optional finding-scoped critic for disputes only
  → transparent deterministic score
  → dashboard + authenticated PDF report
```

Luna receives the merchant name and URL—not findings from another semantic scanner—and chooses what to inspect next. Tools return raw/objective evidence and make no compliance or risk decisions. Browser calls block non-GET/HEAD requests, private networks, unregistered navigation hosts, downloads, form submission, payment, and other mutations.

Visual evidence is sent back to Luna as actual retained image input with its visible text, DOM, URL, destination, controls, association, page position, and prominence measurements. Findings must cite retained first-party evidence IDs. Invalid IDs, affected URLs, screenshot references, and SKUs are rejected or removed before persistence.

The only scanner queue is `orbit-ai-scanner-v1`. There is no semantic fallback. If Luna cannot start, the job becomes `AI_SCAN_FAILED`; if Luna starts but cannot complete a substantive investigation, the job becomes `AI_SCAN_INCOMPLETE`. A local page, image, document, or tool failure retains completed work and lets the audit continue.

## Preserved ORBIT capabilities

- organization/workspace membership, RBAC, authentication, sessions, and merchant-scoped access;
- merchant onboarding, agreements, merchant management, navigation, and dashboard layout;
- Stripe Connect onboarding/status/events;
- PaymentIntent creation, application/platform fees, customer payments, and transaction history;
- WooCommerce Relay configuration, request authentication, order verification, and diagnostics;
- PostgreSQL, Redis, health endpoints, rate limiting, logging, secure HTTP/SSRF protection, storage, and browser primitives.

## Local installation

Requirements: Node.js 20+, Docker with Compose, npm, PostgreSQL, Redis, and Chromium.

```bash
npm install
copy .env.example .env
docker compose up -d
npm run db:migrate
npm run db:seed
npx playwright install chromium
```

Run the web application and the one scanner worker in separate terminals:

```bash
npm run dev
npm run workers
```

Open `http://localhost:3000/sentinel`. The seeded workspace uses an intentionally unreachable demonstration domain; register a publicly reachable merchant site for a real audit.

## Scanner environment

| Variable | Purpose |
|---|---|
| `AI_SCANNER_MODEL` | Primary investigator; defaults to `gpt-5.6-luna` |
| `AI_CRITIC_MODEL` | Optional, blank by default; invoked only for Critical, ambiguous High, contradictory, or low-confidence material findings |
| `AI_SCANNER_REASONING_EFFORT` | Luna reasoning effort |
| `OPENAI_API_KEY` | Server-only Responses API credential |
| `OPENAI_BASE_URL` | Responses API base URL |
| `AI_SCANNER_REQUEST_TIMEOUT_MS` | Timeout for one Luna/critic request |
| `AI_SCANNER_OPENAI_MAX_RETRIES` | Maximum temporary 429 retries for the same Luna request |
| `AI_SCANNER_OPENAI_RETRY_BASE_MS` | Initial exponential-backoff delay when `Retry-After` is absent |
| `AI_SCANNER_OPENAI_RETRY_MAX_MS` | Maximum fallback backoff delay before jitter |
| `AI_SCANNER_OPENAI_RETRY_TOTAL_MS` | Maximum cumulative temporary rate-limit cooldown for one Luna request |
| `AI_SCANNER_OPENAI_MAX_RESUMES` | Maximum persisted cooldown/resume cycles for the same scan after per-request retries are exhausted |
| `AI_SCANNER_MAX_RUNTIME_MS` | Global audit runtime budget |
| `AI_SCANNER_MAX_TOOL_CALLS` | Global Luna browser/tool budget |
| `AI_SCANNER_MAX_TOKENS` | Global cumulative token budget |
| `AI_SCANNER_MAX_COST_USD` | Global approximate monetary budget |
| `AI_SCANNER_CONTEXT_COMPACT_THRESHOLD` | Responses server-side compaction threshold for long tool/image audits |
| `AI_SCANNER_MAX_OUTPUT_TOKENS` | Maximum output for one Luna turn |
| `AI_SCANNER_FINALIZATION_MAX_OUTPUT_TOKENS` | Output allowance for the final strict structured audit |
| `AI_SCANNER_FINALIZATION_TOKEN_RESERVE` | Cumulative token headroom reserved before Luna is forced to finalize |
| `AI_SCANNER_MAX_EVIDENCE_BYTES` | Maximum retained API/PDF/image payload |
| `AI_SCANNER_INPUT_COST_PER_MILLION` | Configurable approximate input-token rate |
| `AI_SCANNER_OUTPUT_COST_PER_MILLION` | Configurable approximate output-token rate |

Temporary OpenAI TPM/RPM throttling honors `retry-after` or the corresponding `x-ratelimit-reset-*` header. If the per-request retry cap is still exhausted, the same scan is checkpointed and delayed in the queue; Luna conversation state, browser storage/current page, coverage, usage, completed tool calls, and retained evidence are restored on continuation.
| `AI_SCANNER_BROWSER_HEADLESS` | Playwright headless mode |
| `SCREENSHOT_STORAGE` | Evidence storage root |

Global budgets are stop conditions, never coverage targets. Before the token, tool, runtime, or cost ceiling is reached, the scanner reserves enough headroom and forces a no-more-tools finalization turn so completed evidence becomes a strict structured audit instead of being discarded at the limit. Reports list actual URLs discovered/opened, visually reviewed pages, visual regions, images, categories, products discovered/verified, documents, checkout states, tool calls, runtime, tokens, and approximate cost. They do not report 100% because a limit was reached.

Temporary OpenAI request or token-per-minute throttles retry only the failed Responses request. `Retry-After` is treated as a minimum; otherwise the scanner uses capped exponential backoff with jitter. Completed browser calls and retained evidence stay in the current Luna conversation. Credit, billing, spend-limit, and usage-quota errors are terminal and are not retried.

Initial browser navigation also has bounded recovery. AI Scanner tries the registered URL and safe first-party `www`/protocol equivalents, accepts a canonical merchant hostname only when it is proven by a bounded HTTP redirect chain originating at the registered site, and retries transient `5xx` responses against that verified destination. It treats a slow `DOMContentLoaded` event as non-fatal after the document commits and preserves completed HTML/text evidence when a viewport capture fails. Luna cannot finalize an otherwise healthy-budget audit immediately after one failed open; it must perform a bounded retry and continue without repeating completed evidence work.

Shared ORBIT configuration also includes `DATABASE_URL`, `REDIS_URL`, `APP_URL`, `INTERNAL_JOB_SECRET`, `ORBIT_SECRET_ENCRYPTION_KEY`, session/seed variables, and Stripe variables documented in `.env.example`.

The optional, disabled-by-default private Ecwid payment adapter and custom payment-domain routing are documented in [`docs/ecwid-private-payments.md`](docs/ecwid-private-payments.md).

## API and scheduling

- `POST /api/ai-scanner/scans` — start or return the active merchant audit;
- `GET /api/ai-scanner/scans/:id` — read persisted status, coverage, tools, products, evidence, findings, and score;
- `GET /api/ai-scanner/scans/:id/report` — authenticated AI Scanner PDF;
- `PATCH /api/ai-scanner/findings/:id` — authorized human finding decision;
- `POST /api/internal/ai-scanner/schedule` — enqueue due monitored sites with `Authorization: Bearer <INTERNAL_JOB_SECRET>`.

Merchant and payment endpoints under `/api/sentinel/merchants/...` are retained for compatibility and continue to serve non-scanner ORBIT functionality. They read AI Scanner v1 results when assembling merchant dashboard data.

## Evidence, scoring, and critic

`AiEvidence` retains exact first-party text/value, DOM context, source/destination URL, metadata, hashes, and optional stored bytes. `AiFindingEvidence` assigns adverse, mitigating, or neutral roles. `AiProduct` preserves canonical product URLs and renders missing SKUs as `Not observed`.

`src/ai-scanner/scoring` applies an inspectable formula to validated severity, confidence, materiality, commercial prominence, visual prominence, product association, and mitigation. It also reserves points for explicit limitations/unobserved core evidence so unknown surfaces cannot automatically score 100. Luna never selects the number.

The optional critic receives one disputed finding and only that finding's evidence. It does not scan the website or review every finding. A critic disagreement sends the finding to human review without erasing Luna's retained conclusion.

## Database migration policy

The AI Scanner v1 migration is additive. It creates `AiScan`, `AiEvidence`, `AiFinding`, `AiFindingEvidence`, `AiProduct`, `AiToolEvent`, and `AiCriticReview`, adds an AI Scanner audit-log relation, and adds the `AI_SCANNER` worker type. It does not drop any production table or data.

Legacy scanner tables remain physically mapped for recovery only and have no AI Scanner v1 runtime/API/worker path. Their proposed retirement is inventoried in `docs/ai-scanner-v1-database-retirement.md`; a separate reviewed migration is required before any drop.

## Security model

- targets are limited to HTTP and HTTPS;
- localhost, internal hostnames, private/link-local/reserved ranges, metadata targets, and URL credentials are blocked;
- DNS and browser resources are validated; navigation is constrained to registered merchant hosts;
- scanner browsing is GET/HEAD-only and cannot submit forms or orders;
- all application queries are organization/merchant scoped;
- password/session, mutation-origin, Zod validation, rate-limit, audit-log, and evidence path-traversal protections remain active;
- secrets are redacted and private chain-of-thought is never logged.

## Tests and validation

```bash
npm run test
npm run typecheck
npm run lint
npx prisma validate
npm run build
```

AI Scanner tests cover the Luna tool loop and pixel handoff, strict evidence-backed output, the complete tool contract, selective critic routing, transparent scoring, unknown-surface reservations, and apparel, laboratory ecommerce, electronics, homewares, SaaS, industrial equipment, and editorial-heavy ecommerce result shapes. The unchanged suites cover authentication, merchant access/onboarding, Stripe, payments, Relay, and shared security.

## Deployment

Do not deploy this refactor automatically. For a reviewed deployment, apply committed additive migrations before traffic:

```bash
npx prisma migrate deploy
```

Deploy the Next.js app with PostgreSQL and Redis, and deploy `Dockerfile.worker` on a persistent host that supports Chromium. Use shared object storage behind `EvidenceStorage` before scaling workers across hosts. Keep database/Redis ports private, use HTTPS, replace development credentials, configure encrypted backups, and monitor evidence retention.
