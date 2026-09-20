import { openDatabase, resolveDatabasePath } from "./database";
import type { PaymentRepository } from "./repository";
import { createSqlitePaymentRepository } from "./sqlite-repository";

/**
 * Repository access point.
 *
 * The production repository is durable SQLite. It is created lazily so that
 * importing a route module (for example during a build) never opens a database
 * file. Tests can substitute a repository with `setPaymentRepository`.
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
    const db = openDatabase(resolveDatabasePath());
    slot[GLOBAL_KEY] = createSqlitePaymentRepository(db);
  }
  return slot[GLOBAL_KEY]!;
}

/** Override the repository (used by tests). */
export function setPaymentRepository(repository: PaymentRepository): void {
  globalSlot()[GLOBAL_KEY] = repository;
}

/** Reset the cached repository so the next call re-opens it. */
export function resetPaymentRepository(): void {
  delete globalSlot()[GLOBAL_KEY];
}

export * from "./repository";
export * from "./types";
export * from "./validation";
