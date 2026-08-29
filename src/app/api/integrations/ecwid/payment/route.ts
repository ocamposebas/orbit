import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ecwidEnabled, getEcwidConfiguration } from "@/integrations/ecwid/config";
import { decryptEcwidPaymentRequest } from "@/integrations/ecwid/decrypt";
import { createOrReuseEcwidPaymentSession, ecwidPaymentRedirect, rejectEcwidPaymentRequest } from "@/integrations/ecwid/service";
import type { EcwidPaymentPayload } from "@/integrations/ecwid/types";
import { apiError, HttpError } from "@/sentinel/http";
import { enforceRateLimit } from "@/sentinel/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

async function encryptedPayload(request: NextRequest) {
  const maximumBytes = 1_600_000;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new HttpError(413, "Invalid Ecwid payment request");
  if (!request.body) throw new HttpError(400, "Invalid Ecwid payment request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new HttpError(413, "Invalid Ecwid payment request");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) throw new HttpError(400, "Invalid Ecwid payment request");
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      const parsed = JSON.parse(body) as { enc_data?: unknown };
      if (typeof parsed.enc_data === "string") return parsed.enc_data;
    } catch { /* handled below */ }
  } else {
    const value = new URLSearchParams(body).get("enc_data");
    if (value) return value;
  }
  throw new HttpError(400, "Invalid Ecwid payment request");
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let payload: EcwidPaymentPayload | undefined;
  try {
    if (!ecwidEnabled()) throw new HttpError(503, "Ecwid payments are not enabled");
    await enforceRateLimit(request, "ecwid-payment-ip", 120);
    const config = getEcwidConfiguration();
    payload = decryptEcwidPaymentRequest(await encryptedPayload(request), config.clientSecret);
    await enforceRateLimit(request, "ecwid-payment-reference", 20, `${payload.storeId}:${payload.cart.order.referenceTransactionId}`);
    const session = await createOrReuseEcwidPaymentSession(payload);
    const location = await ecwidPaymentRedirect(session.id);
    return new Response(null, {
      status: 303,
      headers: { ...responseHeaders, Location: location, "X-ORBIT-Request-ID": requestId },
    });
  } catch (error) {
    if (payload && !(error instanceof HttpError && [400, 403].includes(error.status))) {
      try {
        const returnUrl = await rejectEcwidPaymentRequest(payload, "The payment could not be prepared. Please try again.");
        return NextResponse.redirect(returnUrl, { status: 303, headers: { ...responseHeaders, "X-ORBIT-Request-ID": requestId } });
      } catch { /* preserve the original controlled error */ }
    }
    return apiError(error, requestId);
  }
}
