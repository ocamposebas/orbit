# ORBIT Payments for WooCommerce

ORBIT hosts the customer payment page and keeps Stripe credentials, application fees, processor routing, webhook verification, and payment state outside WordPress. The WooCommerce plugin connects with a one-time code and thereafter signs every server request with its installation credential.

## Public contract

- `POST /v1/woocommerce/installations/exchange`
- `POST /v1/woocommerce/installations/heartbeat`
- `POST /v1/woocommerce/installations/disconnect`
- `POST /v1/woocommerce/checkout-sessions`
- hosted checkout at `/p/{sessionId}`

Signed requests use `X-Orbit-Merchant`, `X-Orbit-Installation`, `X-Orbit-Timestamp`, `X-Orbit-Nonce`, and `X-Orbit-Signature`. The canonical HMAC input is merchant ID, installation ID, timestamp, nonce, uppercase HTTP method, URL path, and the hexadecimal SHA-256 body hash, joined with newline characters.

Before creating a session, ORBIT retrieves `GET /wp-json/orbit-payments/v1/orders/{orderId}` from the registered WordPress origin with the same HMAC protocol. After the existing Stripe webhook confirms payment, ORBIT sends the durable event at `POST /wp-json/orbit-payments/v1/events`. Browser redirects never mark an order paid.

## Runtime configuration

The existing `ORBIT_SECRET_ENCRYPTION_KEY`, Stripe Connect keys, `STRIPE_PAYMENT_METHOD_CONFIGURATION_ID`, `STRIPE_PAYMENTS_WEBHOOK_SECRET`, PostgreSQL, Redis, web process, and worker process remain required. Optionally set `ORBIT_PAYMENTS_PUBLIC_ORIGIN` to the HTTPS payment origin, such as `https://pay.orbit.example`; otherwise the canonical `APP_URL` origin is used.

Apply the additive Prisma migration before enabling the plugin. Keep the existing Stripe payment webhook URL and subscribed PaymentIntent event types unchanged. Run the worker continuously so transient WordPress event-delivery failures are retried with the same event ID.
