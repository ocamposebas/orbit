import { describe, expect, it } from "vitest";
import { paymentFailure } from "@/merchant-portal/data";

describe("payment failure reason", () => {
  it("turns processor decline codes into clear customer-facing causes", () => {
    const intent = { last_payment_error: { decline_code: "insufficient_funds", code: "card_declined", message: "Declined" } } as never;
    expect(paymentFailure(intent, "FAILED")).toEqual({ failureCode: "insufficient_funds", failureReason: "Insufficient funds" });
  });

  it("does not invent a cause for a successful payment", () => {
    expect(paymentFailure(null, "SUCCEEDED")).toEqual({ failureCode: null, failureReason: null });
  });

  it("states when a failed processor reason is unavailable", () => {
    expect(paymentFailure(null, "FAILED")).toEqual({ failureCode: "reason_unavailable", failureReason: "Payment was not approved; processor reason unavailable" });
  });
});
