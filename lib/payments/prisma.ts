import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Prisma client for Neon PostgreSQL.
 *
 * Serverless-safe: the client is created once per process and cached on
 * `globalThis` so hot reloads and warm invocations reuse it. The Neon
 * serverless driver (WebSocket) is used instead of a TCP pool, which is the
 * recommended configuration for Neon on Vercel and avoids connection
 * exhaustion. No filesystem state is involved.
 */

const GLOBAL_KEY = "__arcPayLinkPrismaClient__";

function globalSlot(): typeof globalThis & {
  [GLOBAL_KEY]?: PrismaClient;
} {
  return globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: PrismaClient;
  };
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Configure a Neon PostgreSQL connection string.",
    );
  }

  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

/** The shared Prisma client, created on first use. */
export function getPrismaClient(): PrismaClient {
  const slot = globalSlot();
  if (!slot[GLOBAL_KEY]) {
    slot[GLOBAL_KEY] = createClient();
  }
  return slot[GLOBAL_KEY];
}

/** Clear the cached client (used by tests). */
export function resetPrismaClient(): void {
  delete globalSlot()[GLOBAL_KEY];
}

export type { PrismaClient };
