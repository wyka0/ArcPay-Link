import { beforeEach } from "vitest";

import { setPaymentRepository } from "@/lib/payments";
import { createInMemoryPaymentRepository } from "@/lib/payments/memory-repository";

/**
 * Give every test a fresh in-memory repository so route tests never touch the
 * real SQLite file or leak state between tests. Durable-store tests build their
 * own SQLite databases explicitly.
 */
beforeEach(() => {
  setPaymentRepository(createInMemoryPaymentRepository());
});
