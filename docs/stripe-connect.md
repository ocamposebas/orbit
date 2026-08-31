# ORBIT Stripe Connect onboarding and verification monitoring

This integration stops at connected-account creation, Stripe-hosted documentation collection, and verification-state monitoring. It does not create or process payments.

## Architecture

- ORBIT is the Connect platform. A `Merchant` has at most one `StripeConnectIntegration`; `stripeAccountId` is globally unique and is the only key used to associate Stripe events with merchants.
- Accounts v2 is the default (`STRIPE_CONNECT_ACCOUNT_API=v2`). It creates a merchant-configured account, requests only `card_payments`, gives the merchant a full Stripe Dashboard, and assigns Stripe responsibility for fees and losses. Those settings make Stripe the requirements collector.
- The explicit `v1` compatibility mode is available for Stripe platforms that have not been enabled for Accounts v2. There is no automatic fallback because a silent fallback could create an account with unintended controller semantics.
- Every Account Link is generated server-side, is single-use, uses `account_onboarding`, collects `eventually_due`, includes future requirements, and is returned only to an authenticated OWNER or ADMIN.
- Every return, manual synchronization, and monitored event retrieves the account from Stripe. Browser state and event payload account state are never trusted as authoritative.
- Only normalized requirement keys, capability states, timestamps, and a sanitized raw-state projection are stored. ORBIT does not store identity documents, bank numbers, tax IDs, SSNs, full birth dates, or verification secrets.

## Server environment

```dotenv
STRIPE_SECRET_KEY=rk_test_or_sk_test_value
STRIPE_MODE=test
STRIPE_CONNECT_ACCOUNT_API=v2
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_value
# Optional; normally leave unset to use the Stripe SDK's pinned version.
STRIPE_API_VERSION=
```

`APP_URL` accepts one public ORBIT origin or two comma-separated origins. The first origin is canonical and is used for server-generated links; both origins are accepted for browser mutations. Stripe Account Links created from the alternate origin return to that same origin so its host-only session cookie remains available. Every configured origin used with Stripe must be HTTPS in live deployments.

```dotenv
APP_URL=https://orbit.example,https://alternate.example
```

Each entry must be an HTTP(S) origin only: no path, credentials, query string, or fragment. Do not wrap the pair in JSON. Test and live keys, events, and stored accounts are checked against `STRIPE_MODE`; mismatches fail without changing the merchant relationship.

## Stripe Dashboard setup

1. Activate Connect for the platform and enable Accounts v2 access. The code reports a clear error if v2 is unavailable. If Stripe has not granted v2 access, deliberately configure `STRIPE_CONNECT_ACCOUNT_API=v1` until v2 is enabled.
2. Configure Connect branding and the Stripe-hosted onboarding experience.
3. Add an event destination with URL `https://YOUR_ORBIT_HOST/api/stripe/connect/events`.
4. For Accounts v2, choose events from connected accounts, select the **Thin** payload style, and subscribe to:
   - `v2.core.account[requirements].updated` (required)
   - `v2.core.account[future_requirements].updated`
   - `v2.core.account[configuration.merchant].capability_status_updated`
   - `v2.core.account[configuration.merchant].updated`
   - `v2.core.account.updated`
5. For explicit v1 compatibility mode, use the snapshot event `account.updated` instead. Do not configure the v1 event as a substitute while running v2.
6. Copy that destination's signing secret into `STRIPE_CONNECT_WEBHOOK_SECRET`. Webhook signing secrets are separate in test and live modes.

## Restricted API key permissions

Use a dedicated server-side restricted key when Stripe makes the required v2 resources available in the platform's restricted-key editor. Grant only:

- Core/Connect Accounts: **Write** (account creation and retrieval; Write includes the necessary read operation).
- Core/Connect Account Links: **Write**.
- Platform Account: **Read**, if Stripe exposes it separately, for `/api/health/stripe`.

For `STRIPE_CONNECT_ACCOUNT_API=v1`, the equivalent permissions are Connect Accounts **Write**, Account Links **Write**, and Account **Read** for health. No Customer, PaymentIntent, Checkout, Charge, Transfer, Refund, Payment Method, File, or webhook-management API permission is required. The event destination is configured in the Dashboard, so the runtime key does not need webhook endpoint write access. If Stripe's restricted-key editor groups Accounts v2 behind a gated or unified Connect permission, grant that Connect platform resource **Write**, leave connected-account data access at **None**, and validate both account creation and retrieval in a sandbox before using the key in live mode.

## Routes

- `POST /api/sentinel/merchants/:merchantId/stripe/connect`
- `POST /api/sentinel/merchants/:merchantId/stripe/onboarding`
- `POST /api/sentinel/merchants/:merchantId/stripe/sync`
- `GET /merchants/:merchantId/integrations/stripe/return`
- `GET /merchants/:merchantId/integrations/stripe/refresh`
- `POST /api/stripe/connect/events`
- `GET /api/health/stripe`

The three merchant mutation endpoints require authentication, tenant-scoped merchant access, OWNER or ADMIN, origin validation, and rate limiting. Return and refresh also require an authenticated merchant-scoped session; refresh requires OWNER or ADMIN and always creates a new link.

## Sandbox procedure

1. Apply the migration with the normal non-destructive deployment command (`npx prisma migrate deploy`) against a development database. Never use `prisma migrate reset` on production data.
2. Set sandbox credentials and `STRIPE_MODE=test`; leave `STRIPE_CONNECT_ACCOUNT_API=v2` unless testing the explicit compatibility path.
3. Configure a test-mode thin event destination and its test signing secret.
4. Open an existing ORBIT merchant, select **Integrations**, and click **Connect Stripe** twice. Both requests must resolve to the same `acct_*`.
5. Click **Complete Stripe verification**. Confirm the browser is sent to Stripe, not an ORBIT KYC form. Use Stripe's documented test verification values and documents.
6. Exit or complete onboarding. Confirm return to ORBIT causes an immediate sync and does not claim approval.
7. Revisit an already used Account Link and confirm the refresh route creates a new link.
8. Trigger currently due, past due, and pending verification states in the Stripe sandbox, then confirm the event destination and **Sync Stripe status** update the factual ORBIT status.
9. Send an event with an invalid signature, resend a valid event ID, and send a valid event for an unknown `acct_*`; expect rejection, deduplication, and safe ignore respectively.
10. Confirm `/api/health/stripe` returns only `configured`, `mode`, and `reachable`.

## Live activation

1. Complete Stripe's platform activation and Accounts v2 enablement review.
2. Create a least-privilege live restricted key, ideally IP-restricted to ORBIT's stable egress addresses.
3. Create a separate live thin event destination with the event list above and copy its live signing secret.
4. Set the Coolify secrets, set `STRIPE_MODE=live`, ensure `APP_URL` is the final HTTPS origin, and apply the migration.
5. Verify the health endpoint, then onboard one internal pilot merchant. Confirm the stored integration is `LIVE` and that test accounts cannot be used.
6. Review audit logs and Stripe request logs before enabling the button for additional organizations.

## Operational limitations

- Accounts v2 availability and restricted-key resource labels are controlled by Stripe and can vary by platform. The application never silently falls back to v1.
- Status is point-in-time. Event delivery plus manual sync reduces staleness, but `lastSyncedAt` should always be considered.
- Friendly requirement labels are intentionally broad; ORBIT retains the non-sensitive technical key for debugging and lets Stripe render the actual collection form.
- The integration does not edit previously submitted identity values. It sends users through `account_onboarding` for outstanding requirements.
- No payment flow, charge, transfer, refund, payout initiation, or customer payment UI is implemented.
