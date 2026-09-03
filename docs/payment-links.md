# ORBIT Payment Links

Payment Links creates reusable, public ORBIT-hosted checkout pages without creating store orders or changing existing WooCommerce/Ecwid payments.

## Access model

- The workspace `OWNER` can create platform-owned links labeled and settled as ORBIT.
- `OWNER` and `ADMIN` roles can create links for a connected merchant.
- Other users start with Payment Links disabled. An administrator grants `canCreatePaymentLinks` per user and merchant in **Users & access**.
- The grant enables the capability once. Individual links do not require approval.
- A link's amount, currency, Stripe environment, merchant destination, and ORBIT fee are snapshotted server-side when it is created.

## Stripe destinations

- Platform-owned links create PaymentIntents with the platform secret key and no connected-account context or application fee.
- Merchant links create PaymentIntents with that merchant's exact `stripeContext` and an `application_fee_amount` calculated from the merchant's stored ORBIT fee.
- The signed webhook revalidates PaymentIntent ID, account destination, amount, currency, fee, environment, and ORBIT metadata before recording success.

## Production webhook

Keep the existing connected-account payment destination pointed at:

`POST /api/stripe/payments/events`

Create an additional Stripe event destination for events on the platform account, use the same URL, subscribe to these events, and save its independent signing secret as `STRIPE_PLATFORM_PAYMENTS_WEBHOOK_SECRET`:

- `payment_intent.succeeded`
- `payment_intent.processing`
- `payment_intent.payment_failed`
- `payment_intent.canceled`

Do not reuse or replace `STRIPE_PAYMENTS_WEBHOOK_SECRET`; ORBIT verifies each destination with its own secret.
