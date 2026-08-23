# RGVPRIME customer payment contract

The RGVPRIME checkout source is not in this repository. The checkout must keep WooCommerce order authorization on the RGVPRIME server and send ORBIT only a short-lived signed token.

## 1. Mint the token only after WooCommerce authorizes the order

Use the Relay merchant ID and the same Relay signing secret. Do not put the secret in JavaScript.

```php
function orbit_base64url( string $value ): string {
    return rtrim( strtr( base64_encode( $value ), '+/', '-_' ), '=' );
}

function orbit_checkout_token( WC_Order $order ): string {
    $payload = array(
        'v'          => 1,
        'merchantId' => ORBIT_Relay::merchant_id(),
        'wooOrderId' => $order->get_id(),
        'exp'         => time() + 600,
        'nonce'       => orbit_base64url( random_bytes( 24 ) ),
    );
    $encoded = orbit_base64url( wp_json_encode( $payload, JSON_UNESCAPED_SLASHES ) );
    return $encoded . '.' . hash_hmac( 'sha256', $encoded, ORBIT_Relay::signing_secret() );
}
```

Before calling that function, RGVPRIME must load the order locally and authorize the current WooCommerce customer/session. For a guest order, compare the supplied WooCommerce order key to `$order->get_order_key()` with `hash_equals`. For a customer order, also require the current customer to own the order. Reject paid, canceled, refunded, failed, or zero-total orders. The browser must never choose `merchantId`, `wooOrderId`, amount, or currency independently.

Have an RGVPRIME server endpoint proxy the token to ORBIT:

```php
$response = wp_remote_post(
    ORBIT_Relay::api_url() . '/api/payments/checkout',
    array(
        'timeout' => 20,
        'headers' => array( 'Content-Type' => 'application/json' ),
        'body'    => wp_json_encode( array( 'checkoutToken' => orbit_checkout_token( $order ) ) ),
    )
);
```

Return ORBIT's four checkout fields to the authorized browser without caching them.

## 2. Mount and confirm the Payment Element

Install `@stripe/stripe-js` and `@stripe/react-stripe-js`. The connected-account context is required because ORBIT creates a direct charge.

```tsx
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useMemo, type FormEvent } from "react";

type OrbitCheckout = {
  orbitTransactionId: string;
  clientSecret: string;
  connectedAccountId: string;
  publishableKey: string;
};

export function OrbitPayment({ config, returnUrl }: { config: OrbitCheckout; returnUrl: string }) {
  const stripe = useMemo(() => loadStripe(config.publishableKey, {
    stripeAccount: config.connectedAccountId,
  }), [config.publishableKey, config.connectedAccountId]);
  return (
    <Elements stripe={stripe} options={{ clientSecret: config.clientSecret }}>
      <PaymentForm returnUrl={returnUrl} />
    </Elements>
  );
}

function PaymentForm({ returnUrl }: { returnUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
    });
    if (error) window.alert(error.message ?? "Payment could not be confirmed.");
  }
  return <form onSubmit={submit}><PaymentElement /><button type="submit">Pay now</button></form>;
}
```

The return page may display status only. It must not mark the WooCommerce order paid; the verified Stripe webhook does that.

## 3. Required Relay production completion change

The installed Relay 1.0.0 endpoint only accepts `orb_test_*`. Before live customer payments, update its existing signed `POST /wp-json/orbit/v1/orders/{orderId}/payment` implementation to accept only production IDs matching:

```php
if ( ! preg_match( '/^orb_tx_[A-Za-z0-9_-]{16,128}$/', $transaction_id ) ) {
    return new WP_Error( 'orbit_transaction_invalid', 'A valid ORBIT transaction ID is required.', array( 'status' => 400 ) );
}
```

Keep the endpoint's current HMAC authentication and merchant match. If the order is already paid with the same `_orbit_transaction_id`, return `already_processed: true`; if paid by another transaction, return 409. Otherwise save `_orbit_transaction_id`, call `$order->payment_complete( $transaction_id )`, and return the existing minimal response. The test-completion toggle must not gate `orb_tx_*` production completions.
