import type { PaymentRepository } from "./repository";
import { getPrismaClient } from "./prisma";
import { createPrismaPaymentRepository } from "./prisma-repository";

/**
 * Repository access point.
 *
 * Production uses the Prisma/PostgreSQL (Neon) repository. It is created lazily
 * so that importing a route module (for example during a build) never opens a
 * database connection. Tests substitute a repository with `setPaymentRepository`.
 */

const GLOBAL_KEY = "__arcPayLinkPaymentRepository__";

function globalSlot(): typeof globalThis & {
  [GLOBAL_KEY]?: PaymentRepository;
} {
  return globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: PaymentRepository;
  };
}

/** The current repository, creating the durable one on first use. */
export function getPaymentRepository(): PaymentRepository {
  const slot = globalSlot();
  if (!slot[GLOBAL_KEY]) {
    slot[GLOBAL_KEY] = createPrismaPaymentRepository(getPrismaClient());
  }
  return slot[GLOBAL_KEY]!;
}

/** Override the repository (used by tests). */
export function setPaymentRepository(repository: PaymentRepository): void {
  globalSlot()[GLOBAL_KEY] = repository;
}

/** Reset the cached repository so the next call re-creates it. */
export function resetPaymentRepository(): void {
  delete globalSlot()[GLOBAL_KEY];
}

export * from "./repository";
export * from "./types";
export * from "./validation";
