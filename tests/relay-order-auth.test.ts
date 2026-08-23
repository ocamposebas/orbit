import { describe, expect, it } from "vitest";
import { createOrbitRelayAuthHeaders, signOrbitRelayRequest } from "@/commerce/woocommerce/auth";

describe("ORBIT Relay HMAC authentication", () => {
  it("matches the WordPress plugin canonical GET signature exactly", () => {
    expect(signOrbitRelayRequest({
      merchantId: "merchant_1",
      timestamp: 1_787_438_400,
      nonce: "nonce_1234567890abcd",
      method: "get",
      path: "/wp-json/orbit/v1/orders/1234",
      rawBody: "",
      secret: "wordpress-relay-signing-secret",
    })).toBe("322e1004704556ae31634a8bce89d45649bb8a7f92458368d7f34cb3185ccd92");
  });

  it("creates all four required headers with a plugin-compatible nonce", () => {
    const headers = createOrbitRelayAuthHeaders({
      merchantId: "merchant_1",
      timestamp: 1_787_438_400,
      nonce: "nonce_1234567890abcd",
      method: "GET",
      path: "/wp-json/orbit/v1/orders/1234",
      secret: "wordpress-relay-signing-secret",
    });
    expect(headers).toEqual({
      "X-Orbit-Merchant": "merchant_1",
      "X-Orbit-Timestamp": "1787438400",
      "X-Orbit-Nonce": "nonce_1234567890abcd",
      "X-Orbit-Signature": "322e1004704556ae31634a8bce89d45649bb8a7f92458368d7f34cb3185ccd92",
    });
  });
});
