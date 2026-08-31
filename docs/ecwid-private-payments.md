# Ecwid private payment adapter

ORBIT exposes an isolated Ecwid adapter while keeping the existing Stripe Connect payment engine and webhook authoritative.

## Configuration

The integration is disabled by default. Configure these server-side values on the ORBIT web service and on the payment reconciliation worker:

```dotenv
ECWID_ENABLED=false
ECWID_STORE_ID=
ECWID_CLIENT_ID=
ECWID_CLIENT_SECRET=
ECWID_SECRET_TOKEN=
ECWID_ORBIT_MERCHANT_ID=
ECWID_CHECKOUT_MODE=STRIPE_CHECKOUT
ECWID_PUBLIC_CHECKOUT_ORIGIN=https://pay.coreaminosresearch.com
```

`ECWID_ORBIT_MERCHANT_ID` is the existing ORBIT merchant that owns this one private Ecwid store. None of these values are public frontend variables. Keep `ECWID_ENABLED=false` until the app credentials, merchant mapping, migration, and Stripe webhook have been verified.

The private Ecwid app also needs permission to update orders (`update_orders`). Its Payment URL is:

```text
https://<public-payment-host>/api/integrations/ecwid/payment
```

## Checkout and completion flow

1. Ecwid POSTs `enc_data`; ORBIT authenticates AES-128-GCM and validates the configured store and token.
2. ORBIT creates or reuses one internal session keyed by `storeId + referenceTransactionId`.
3. In `STRIPE_CHECKOUT` mode, ORBIT creates a Stripe-hosted Checkout Session as a direct charge on the same connected account used by the existing payment engine. The amount, currency, application fee, PMC, merchant, and metadata come only from the stored server-side records.
4. The Checkout Session uses a stable Stripe idempotency key derived from the unpredictable ORBIT payment session ID. Its Stripe ID is also stored with a unique database constraint, so a repeated Ecwid POST cannot create a second logical Checkout Session.
5. Stripe Checkout creates the PaymentIntent. ORBIT attaches that PaymentIntent to the existing `PaymentTransaction`; `payment_intent.succeeded` on the existing connected-account payment webhook remains the authoritative paid transition.
6. The success callback retrieves both the stored Checkout Session and PaymentIntent from Stripe. A browser redirect alone never marks the order paid.
7. ORBIT synchronizes `PAID` to Ecwid and only then redirects to the exact encrypted-at-rest Ecwid return URL.

`ORBIT_HOSTED` remains a separate supported mode. It continues to use `/pay/<sessionId>` and the existing ORBIT-hosted Elements UI. The mode is persisted per Ecwid payment session, so changing the environment setting cannot silently change an already-created attempt.

If the buyer selects Stripe Checkout's cancel action, ORBIT retrieves the stored Checkout Session. An open session is expired server-side before ORBIT marks the attempt `INCOMPLETE`; if Stripe already reports the Session complete, paid, or processing, cancellation cannot overwrite that state. Simply closing the browser performs no state transition. Delayed payments stay processing until Stripe reports their authoritative result.

An Ecwid API outage never charges the buyer again. The ORBIT transaction remains successful, the session is marked `PAID_SYNC_PENDING`, and the existing payment reconciliation worker retries with bounded exponential delays.

## Custom payment domains

The checkout does not use the incoming `Host` to identify a merchant. Merchant identity comes exclusively from the stored payment session. `ECWID_PUBLIC_CHECKOUT_ORIGIN` is a trusted routing-only origin for Stripe success/cancel callbacks; when omitted it defaults to the first, canonical origin in `APP_URL`.

For `pay.coreaminosresearch.com`:

1. Add a DNS record pointing the subdomain to the public reverse proxy in front of ORBIT.
2. Provision TLS for that hostname.
3. Proxy the hostname to the same ORBIT web service and allow `/pay/*`, `/_next/*`, and `/api/integrations/ecwid/*` without caching.
4. Configure the Ecwid Payment URL with that hostname.
5. Set `ECWID_PUBLIC_CHECKOUT_ORIGIN` to the HTTPS payment hostname. Stripe-hosted Checkout itself is served by Stripe; a Stripe custom Checkout domain is a separate optional Stripe product.

`/pay/<sessionId>` remains available for `ORBIT_HOSTED` and as the processing/status landing page. Do not cache payment pages, Ecwid endpoints, Stripe return handlers, or their redirects at Cloudflare or another proxy.

Current branding uses the merchant's `businessName`, which already exists in ORBIT. A logo or richer theme can be added later if ORBIT gains authoritative per-merchant visual configuration; the request hostname must not become that configuration source.

## Operational checks

- Apply the additive Prisma migration before enabling the feature.
- Keep `STRIPE_PAYMENTS_WEBHOOK_SECRET`, `STRIPE_PAYMENT_METHOD_CONFIGURATION_ID`, Stripe platform keys, and `ORBIT_SECRET_ENCRYPTION_KEY` configured as they are for the existing payment engine.
- Run the payment reconciliation worker with the Ecwid variables above.
- Confirm proxy/CDN rules return `Cache-Control: no-store` unchanged.
- Ensure the connected-account payment webhook receives `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, and `payment_intent.canceled`.
- Test duplicate Ecwid POSTs, Stripe Checkout cancel/expiry, a card decline, an approved payment, a delayed method, a delayed webhook, and an Ecwid API outage.
