import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/sentinel/auth/password";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://orbit:orbit@localhost:5432/orbit?schema=public";
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function seed() {
  const organization = await db.organization.upsert({ where: { slug: "demo-workspace" }, update: { name: "Demo Workspace", isDemo: true }, create: { name: "Demo Workspace", slug: "demo-workspace", isDemo: true } });
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@orbit.local").toLowerCase();
  const seedPassword = process.env.SEED_ADMIN_PASSWORD ?? "orbit-demo-change-me";
  const existingUser = await db.user.findUnique({ where: { email: adminEmail } });
  const passwordHash = existingUser?.passwordHash ?? await hashPassword(seedPassword);
  const user = await db.user.upsert({ where: { email: adminEmail }, update: { name: "Demo Operator", passwordHash }, create: { email: adminEmail, name: "Demo Operator", passwordHash, passwordUpdatedAt: new Date() } });
  await db.membership.upsert({ where: { organizationId_userId: { organizationId: organization.id, userId: user.id } }, update: { role: "OWNER" }, create: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
  const merchant = await db.merchant.upsert({ where: { organizationId_slug: { organizationId: organization.id, slug: "demo-merchant" } }, update: { isDemo: true }, create: { organizationId: organization.id, businessName: "Demo Merchant", slug: "demo-merchant", industry: "Research products", country: "United States", businessDescription: "Illustrative research-product storefront used only to demonstrate ORBIT Sentinel workflows.", status: "REVIEW_REQUIRED", isDemo: true } });
  const site = await db.merchantSite.upsert({ where: { merchantId_normalizedUrl: { merchantId: merchant.id, normalizedUrl: "https://sentinel-demo.invalid/" } }, update: {}, create: { merchantId: merchant.id, url: "https://sentinel-demo.invalid/", normalizedUrl: "https://sentinel-demo.invalid/", hostname: "sentinel-demo.invalid", lastScannedAt: new Date() } });
  const existingScan = await db.scan.findFirst({ where: { merchantId: merchant.id }, orderBy: { createdAt: "desc" } });
  const scan = existingScan ?? await db.scan.create({ data: { merchantId: merchant.id, siteId: site.id, mode: "FULL", status: "COMPLETED", progress: { stage: "completed", message: "Demo scan completed", urlsFound: 18, pagesProcessed: 18, pagesTotal: 18, productsDetected: 3, policiesDetected: 5, claimsInspected: 14, findings: 2, updatedAt: new Date().toISOString() }, pagesDiscovered: 18, pagesProcessed: 18, productsDetected: 3, policiesDetected: 5, findingsCreated: 2, scoreAfter: 86, startedAt: new Date(Date.now() - 180_000), completedAt: new Date() } });

  for (const policy of ["TERMS", "PRIVACY", "REFUND", "SHIPPING", "CONTACT"] as const) await db.policy.upsert({ where: { merchantId_siteId_type: { merchantId: merchant.id, siteId: site.id, type: policy } }, update: { coverage: "FOUND" }, create: { merchantId: merchant.id, siteId: site.id, type: policy, coverage: "FOUND", url: `https://sentinel-demo.invalid/${policy.toLowerCase()}` } });
  for (const product of [{ url: "catalog/reference-alpha", name: "Reference Alpha 10mg", sku: "DEMO-A10", price: "45.00", claims: [] }, { url: "catalog/reference-beta", name: "Reference Beta 20mg", sku: "DEMO-B20", price: "62.00", claims: ["Supports rapid weight loss."] }, { url: "catalog/reference-gamma", name: "Reference Gamma 5mg", sku: "DEMO-G05", price: "38.00", claims: [] }]) await db.product.upsert({ where: { merchantId_canonicalUrl: { merchantId: merchant.id, canonicalUrl: `https://sentinel-demo.invalid/${product.url}` } }, update: {}, create: { merchantId: merchant.id, siteId: site.id, canonicalUrl: `https://sentinel-demo.invalid/${product.url}`, name: product.name, sku: product.sku, currentPrice: product.price, claims: product.claims, disclaimers: ["For research use only."] } });

  const demoFindings = [
    { fingerprint: "demo-consumer-claim-v1", severity: "HIGH" as const, confidence: 0.96, category: "Marketing claim", title: "Potential consumer-directed efficacy claim", description: "Language on the page may promise or imply a consumer outcome.", url: "https://sentinel-demo.invalid/catalog/reference-beta", pageType: "PRODUCT" as const, detectedText: "Supports rapid weight loss.", reason: "The statement presents a consumer-directed outcome rather than laboratory context.", recommendedAction: "Review the wording and ensure it remains consistent with the declared research positioning." },
    { fingerprint: "demo-age-policy-v1", severity: "MEDIUM" as const, confidence: 0.82, category: "Policy coverage", title: "Age policy needs review", description: "A distinct age-policy control was not found in the illustrative scan.", url: "https://sentinel-demo.invalid/", pageType: "HOME" as const, detectedText: null, reason: "No discovered policy met the age-coverage classifier threshold.", recommendedAction: "Review whether an age policy is appropriate for the products and audience." },
  ];
  for (const item of demoFindings) {
    const existing = await db.finding.findFirst({ where: { merchantId: merchant.id, fingerprint: item.fingerprint } });
    if (!existing) {
      const finding = await db.finding.create({ data: { organizationId: organization.id, merchantId: merchant.id, siteId: site.id, scanId: scan.id, status: "NEEDS_REVIEW", ...item } });
      await db.findingEvidence.create({ data: { findingId: finding.id, kind: "TEXT", pageUrl: item.url, normalizedText: item.detectedText, evidenceSnippet: item.detectedText, pageHash: item.fingerprint, modelVersion: "local-semantic-v1", classificationConfidence: item.confidence, metadata: { demo: true, immutable: true } } });
    }
  }
  await db.healthScore.upsert({ where: { merchantId_scanId: { merchantId: merchant.id, scanId: scan.id } }, update: {}, create: { merchantId: merchant.id, scanId: scan.id, total: 86, formulaVersion: "orbit-health-v1", explanation: { demo: true, basis: "Illustrative score for the seeded demo workspace." }, components: { create: [{ key: "POLICY_COVERAGE", label: "Policy coverage", score: 92, deductions: [{ points: 8, title: "Age policy needs review" }] }, { key: "PRODUCT_INTEGRITY", label: "Product integrity", score: 100, deductions: [] }, { key: "RESEARCH_CONTROLS", label: "Research controls", score: 100, deductions: [] }, { key: "MARKETING_RISK", label: "Marketing risk", score: 84, deductions: [{ points: 16, title: "Potential consumer-directed efficacy claim" }] }, { key: "SITE_CONTROLS", label: "Checkout controls", score: 100, deductions: [] }, { key: "OPERATIONAL_CONSISTENCY", label: "Operational consistency", score: 100, deductions: [] }] } } });
  const general = await db.ruleSet.upsert({ where: { code_version: { code: "ORBIT-GENERAL", version: 1 } }, update: {}, create: { code: "ORBIT-GENERAL", version: 1, name: "ORBIT General", description: "Baseline website intelligence and policy-coverage signals." } });
  const ruleDefinitions = [
    ["MKT-CLAIM-001", "Potential consumer-directed efficacy claim", "Marketing", "HIGH", "SEMANTIC", "PRODUCT"],
    ["MKT-MEDICAL-001", "Explicit medical or disease claim", "Medical claim", "CRITICAL", "SEMANTIC", "PRODUCT"],
    ["MKT-TESTIMONIAL-001", "Potential human outcome testimonial", "Human outcome evidence", "HIGH", "SEMANTIC", null],
    ["MKT-SLUG-001", "Consumer-oriented URL requires context review", "Navigation language", "MEDIUM", "DETERMINISTIC", null],
    ["RX-REVIEW-001", "Prescription or pharmacy context requires review", "Business-model signal", "MEDIUM", "SEMANTIC", null],
    ["RSRCH-ADMIN-001", "Potential administration instruction", "Research positioning", "HIGH", "SEMANTIC", "PRODUCT"],
    ["RSRCH-DISC-001", "Research-use disclosure not detected on product page", "Research controls", "MEDIUM", "CONTRADICTION", "PRODUCT"],
    ["RSRCH-COVERAGE-001", "Research-use coverage is incomplete across product pages", "Research controls", "MEDIUM", "CONTRADICTION", "PRODUCT"],
    ["PROD-PRICE-001", "Product price not detected", "Product integrity", "LOW", "DETERMINISTIC", "PRODUCT"],
    ["PROD-DISC-001", "Qualifying language not detected", "Disclosure", "MEDIUM", "DETERMINISTIC", "PRODUCT"],
    ["SITE-ACCESS-001", "Unexpected public content gate", "Site controls", "LOW", "DETERMINISTIC", null],
    ["SITE-HTTPS-001", "Public website is not using HTTPS", "Website legitimacy", "HIGH", "DETERMINISTIC", "HOME"],
    ["SITE-HOME-001", "Homepage returned an error response", "Website legitimacy", "HIGH", "DETERMINISTIC", "HOME"],
    ["SITE-PLACEHOLDER-001", "Public placeholder content detected", "Website legitimacy", "MEDIUM", "DETERMINISTIC", null],
    ["SITE-COMING-SOON-001", "Website appears to be pre-launch", "Website legitimacy", "MEDIUM", "DETERMINISTIC", "HOME"],
    ["SITE-BROKEN-CRITICAL-001", "Critical policy or support URL is broken", "Operational risk", "MEDIUM", "DETERMINISTIC", null],
    ["POLICY-QUALITY-001", "Policy content may be incomplete", "Policy quality", "LOW", "DETERMINISTIC", null],
    ["CHECKOUT-TERMS-001", "Terms acknowledgement not detected", "Checkout control", "MEDIUM", "DETERMINISTIC", "CHECKOUT"],
    ["POLICY-PRIVACY-001", "Privacy policy not found", "Policy coverage", "HIGH", "DETERMINISTIC", null],
    ["POLICY-TERMS-001", "Terms not found", "Policy coverage", "MEDIUM", "DETERMINISTIC", null],
    ["POLICY-REFUND-001", "Refund policy not found", "Policy coverage", "MEDIUM", "DETERMINISTIC", null],
    ["POLICY-SHIPPING-001", "Shipping policy not found", "Policy coverage", "MEDIUM", "DETERMINISTIC", null],
    ["POLICY-CONTACT-001", "Contact page not found", "Policy coverage", "MEDIUM", "DETERMINISTIC", null],
    ["POSITION-CONFLICT-001", "Research and consumer positioning conflict", "Positioning conflict", "HIGH", "CONTRADICTION", null],
    ["POSITION-COSMETIC-001", "Cosmetic positioning conflict", "Positioning conflict", "HIGH", "CONTRADICTION", "PRODUCT"],
    ["PRODUCT-CONCENTRATION-001", "Potential concentration mismatch", "Product consistency", "MEDIUM", "CONTRADICTION", "PRODUCT"],
  ] as const;
  for (const [key, name, category, severity, evaluationType, appliesTo] of ruleDefinitions) {
    const rule = await db.rule.upsert({ where: { ruleSetId_key: { ruleSetId: general.id, key } }, update: {}, create: { ruleSetId: general.id, key } });
    const versionData = { name, description: `${name} observed by ORBIT Sentinel.`, category, severity, evaluationType, appliesTo, condition: { key, requiresEvidence: true }, remediationGuidance: "Review the observation in context and document the resulting decision." };
    await db.ruleVersion.upsert({ where: { ruleId_version: { ruleId: rule.id, version: 1 } }, update: versionData, create: { ruleId: rule.id, version: 1, ...versionData } });
  }
  if (!(await db.auditLog.findFirst({ where: { organizationId: organization.id, action: "demo.seeded" } }))) await db.auditLog.create({ data: { organizationId: organization.id, merchantId: merchant.id, action: "demo.seeded", targetType: "Organization", targetId: organization.id, metadata: { demo: true } } });
  console.log(`Seeded ${organization.name}. Sign in with ${adminEmail}; use SEED_ADMIN_PASSWORD or the documented development default.`);
}

seed().finally(() => db.$disconnect());
