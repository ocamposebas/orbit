import "dotenv/config";

import { getDatabase } from "../src/sentinel/db";
import { getStripeClient, getStripeConfiguration, stripeEnvironment } from "../src/stripe/client";

const [, , merchantIdArgument, domainArgument = "rgvprimellc.com"] = process.argv;
const merchantId = merchantIdArgument?.trim();
const domain = domainArgument.trim().toLowerCase();

function fail(message: string): never {
  throw new Error(message);
}

async function registerPaymentMethodDomain() {
  if (!merchantId || merchantId.length > 80) fail("A valid merchant ID is required.");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    fail("A valid bare HTTPS domain is required.");
  }

  const database = getDatabase();
  const integration = await database.stripeConnectIntegration.findUnique({
    where: { merchantId },
    select: { stripeAccountId: true, stripeEnvironment: true },
  });

  if (!integration) fail("The merchant does not have a Stripe connected account.");

  const configuration = getStripeConfiguration();
  if (!configuration.configured) fail("Stripe is not configured in this environment.");
  if (integration.stripeEnvironment !== stripeEnvironment(configuration.mode)) {
    fail("The merchant and Stripe environment do not match.");
  }

  const stripe = getStripeClient();
  const requestOptions = { stripeContext: integration.stripeAccountId };
  const existingDomains = await stripe.paymentMethodDomains.list(
    { domain_name: domain, limit: 10 },
    requestOptions,
  );
  let paymentDomain = existingDomains.data.find((candidate) => candidate.domain_name === domain);

  if (!paymentDomain) {
    paymentDomain = await stripe.paymentMethodDomains.create(
      { domain_name: domain, enabled: true },
      requestOptions,
    );
  } else if (!paymentDomain.enabled) {
    paymentDomain = await stripe.paymentMethodDomains.update(
      paymentDomain.id,
      { enabled: true },
      requestOptions,
    );
  }

  if (paymentDomain.apple_pay.status !== "active") {
    paymentDomain = await stripe.paymentMethodDomains.validate(
      paymentDomain.id,
      {},
      requestOptions,
    );
  }

  console.info(JSON.stringify({
    registered: true,
    enabled: paymentDomain.enabled,
    applePayActive: paymentDomain.apple_pay.status === "active",
  }));
}

registerPaymentMethodDomain()
  .catch((error: unknown) => {
    const stripeError = error as { type?: string; code?: string; statusCode?: number };
    console.error(JSON.stringify({
      registered: false,
      errorType: stripeError.type ?? "configuration_error",
      errorCode: stripeError.code ?? "registration_failed",
      statusCode: stripeError.statusCode ?? null,
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDatabase().$disconnect();
  });
