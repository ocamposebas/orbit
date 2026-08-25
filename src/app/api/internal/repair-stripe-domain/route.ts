import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIPE_API = "https://api.stripe.com/v1";
const CONNECTED_ACCOUNT_ID = "acct_1U7P60IzxwHmpViL";
const DOMAIN_NAME = "rgvprimellc.com";
const REPAIR_HEADER = "rgv-domain-repair-20260824";

type StripeDomain = {
  id: string;
  domain_name: string;
  enabled: boolean;
  livemode: boolean;
  apple_pay?: { status?: string };
  google_pay?: { status?: string };
  link?: { status?: string };
};

async function stripeRequest<T>(secret: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${STRIPE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Stripe-Account": CONNECTED_ACCOUNT_ID,
      ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error?.message || `Stripe returned HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

function publicDomain(domain: StripeDomain) {
  return {
    id: domain.id,
    domainName: domain.domain_name,
    enabled: domain.enabled,
    livemode: domain.livemode,
    applePay: domain.apple_pay?.status || null,
    googlePay: domain.google_pay?.status || null,
    link: domain.link?.status || null,
  };
}

export async function POST(request: NextRequest) {
  if (request.headers.get("x-rgv-domain-repair") !== REPAIR_HEADER) {
    return NextResponse.json({ success: false, message: "Not found" }, { status: 404 });
  }

  const secret = String(process.env.STRIPE_DOMAIN_KEY || "").trim();
  if (!secret.startsWith("sk_live_")) {
    return NextResponse.json(
      { success: false, message: "STRIPE_DOMAIN_KEY is not configured" },
      { status: 503 },
    );
  }

  try {
    const listing = await stripeRequest<{ data?: StripeDomain[] }>(secret, "/payment_method_domains?limit=100");
    let domain = listing.data?.find((entry) => entry.domain_name === DOMAIN_NAME);

    if (!domain) {
      domain = await stripeRequest<StripeDomain>(secret, "/payment_method_domains", {
        method: "POST",
        body: new URLSearchParams({ domain_name: DOMAIN_NAME }),
      });
    } else if (!domain.enabled) {
      domain = await stripeRequest<StripeDomain>(secret, `/payment_method_domains/${domain.id}`, {
        method: "POST",
        body: new URLSearchParams({ enabled: "true" }),
      });
    }

    const validated = await stripeRequest<StripeDomain>(secret, `/payment_method_domains/${domain.id}/validate`, {
      method: "POST",
      body: new URLSearchParams(),
    });

    return NextResponse.json({
      success: true,
      stripeAccount: CONNECTED_ACCOUNT_ID,
      domain: publicDomain(validated),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return NextResponse.json({
      success: false,
      message: cause instanceof Error ? cause.message : "Stripe domain repair failed",
    }, { status: 502 });
  }
}
