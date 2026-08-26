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
  const merchant = await db.merchant.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "demo-merchant" } },
    update: { isDemo: true },
    create: { organizationId: organization.id, businessName: "Demo Merchant", slug: "demo-merchant", industry: "General ecommerce", country: "United States", businessDescription: "Illustrative merchant workspace. Start AI Scanner v1 against a registered reachable site to create evidence-backed results.", status: "ONBOARDING", isDemo: true },
  });
  await db.merchantSite.upsert({
    where: { merchantId_normalizedUrl: { merchantId: merchant.id, normalizedUrl: "https://demo.orbit.invalid/" } },
    update: {},
    create: { merchantId: merchant.id, url: "https://demo.orbit.invalid/", normalizedUrl: "https://demo.orbit.invalid/", hostname: "demo.orbit.invalid" },
  });
  if (!(await db.auditLog.findFirst({ where: { organizationId: organization.id, action: "demo.seeded" } }))) {
    await db.auditLog.create({ data: { organizationId: organization.id, merchantId: merchant.id, action: "demo.seeded", targetType: "Organization", targetId: organization.id, metadata: { demo: true, scanner: "orbit-ai-scanner-v1" } } });
  }
  console.log(`Seeded ${organization.name}. Sign in with ${adminEmail}; use SEED_ADMIN_PASSWORD or the documented development default.`);
}

seed().finally(() => db.$disconnect());
