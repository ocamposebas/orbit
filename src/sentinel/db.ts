import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getServerEnv } from "./config";

const globalDatabase = globalThis as unknown as { orbitPrisma?: PrismaClient };

export function getDatabase(): PrismaClient {
  if (!globalDatabase.orbitPrisma) {
    const adapter = new PrismaPg({ connectionString: getServerEnv().DATABASE_URL });
    globalDatabase.orbitPrisma = new PrismaClient({ adapter });
  }
  return globalDatabase.orbitPrisma;
}
