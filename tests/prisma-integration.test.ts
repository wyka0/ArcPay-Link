import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPrismaPaymentRepository,
  type PrismaPaymentRepository,
} from "@/lib/payments/prisma-repository";
import { TransactionAlreadyClaimedError } from "@/lib/payments/repository";

/**
 * Live PostgreSQL integration tests.
 *
 * These run only when `TEST_DATABASE_URL` is set to a **Neon** connection
 * string (the client uses the Neon serverless adapter). Locally they are
 * skipped; the deterministic in-memory suite in
 * `tests/prisma-repository.test.ts` always runs.
 *
 * Before running, apply the schema:
 *   TEST_DATABASE_URL=... npm run prisma:migrate:deploy
 */

const TEST_URL = process.env.TEST_DATABASE_URL?.trim();
const hasDatabase = Boolean(TEST_URL);

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const PAYER = "0x3333333333333333333333333333333333333333";
const runId = `it-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const txHash = (suffix: string) =>
  `0x${(runId + suffix)
    .replace(/[^a-z0-9]/g, "")
    .padEnd(64, "0")
    .slice(0, 64)}` as const;

const INPUT = {
  amountUsdc: "5.000000",
  amountBaseUnits: "5000000",
  description: "integration",
  recipient: RECIPIENT as `0x${string}`,
};

let repo: PrismaPaymentRepository;
let prisma: {
  payment: {
    update: (args: unknown) => Promise<unknown>;
    deleteMany: (args: unknown) => Promise<unknown>;
  };
  txClaim: { deleteMany: (args: unknown) => Promise<unknown> };
};
const createdIds: string[] = [];

beforeAll(async () => {
  if (!hasDatabase) return;
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const { PrismaClient } = await import("@/lib/generated/prisma/client");
  const client = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: TEST_URL! }),
  });
  prisma = client as unknown as typeof prisma;
  repo = createPrismaPaymentRepository(client);
});

afterAll(async () => {
  if (!hasDatabase) return;
  if (createdIds.length > 0) {
    await prisma.txClaim.deleteMany({
      where: { paymentId: { in: createdIds } },
    });
    await prisma.payment.deleteMany({ where: { id: { in: createdIds } } });
  }
});

describe.skipIf(!hasDatabase)(
  "PrismaPaymentRepository against PostgreSQL",
  () => {
    it("A/B. creates and retrieves a payment", async () => {
      const payment = await repo.create(INPUT);
      createdIds.push(payment.id);
      expect(payment.status).toBe("PENDING");

      const found = await repo.getById(payment.id);
      expect(found?.id).toBe(payment.id);
      expect(found?.amountBaseUnits).toBe("5000000");
    });

    it("C/D. claims a transaction and persists the update", async () => {
      const payment = await repo.create(INPUT);
      createdIds.push(payment.id);

      const confirmed = await repo.claim(payment.id, {
        txHash: txHash("a"),
        payer: PAYER,
      });
      expect(confirmed.status).toBe("CONFIRMED");
      expect(confirmed.txHash).toBe(txHash("a").toLowerCase());
      expect(await repo.findClaimingPaymentId(txHash("a"))).toBe(payment.id);
    });

    it("E. same payment + same hash is idempotent", async () => {
      const payment = await repo.create(INPUT);
      createdIds.push(payment.id);
      await repo.claim(payment.id, { txHash: txHash("b"), payer: PAYER });
      const again = await repo.claim(payment.id, {
        txHash: txHash("b"),
        payer: PAYER,
      });
      expect(again.status).toBe("CONFIRMED");
    });

    it("F. different payment + same hash is rejected", async () => {
      const first = await repo.create(INPUT);
      const second = await repo.create(INPUT);
      createdIds.push(first.id, second.id);
      await repo.claim(first.id, { txHash: txHash("c"), payer: PAYER });

      await expect(
        repo.claim(second.id, { txHash: txHash("c"), payer: PAYER }),
      ).rejects.toThrow(TransactionAlreadyClaimedError);
      expect((await repo.getById(second.id))?.status).toBe("PENDING");
    });

    it("G. concurrent claims cannot create two owners", async () => {
      const a = await repo.create(INPUT);
      const b = await repo.create(INPUT);
      createdIds.push(a.id, b.id);
      const hash = txHash("d");

      const results = await Promise.allSettled([
        repo.claim(a.id, { txHash: hash, payer: PAYER }),
        repo.claim(b.id, { txHash: hash, payer: PAYER }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const statuses = [
        (await repo.getById(a.id))?.status,
        (await repo.getById(b.id))?.status,
      ];
      expect(statuses.filter((s) => s === "CONFIRMED")).toHaveLength(1);
      expect([a.id, b.id]).toContain(await repo.findClaimingPaymentId(hash));
    });

    it("H. database CHECK constraints are present", async () => {
      const payment = await repo.create(INPUT);
      createdIds.push(payment.id);

      // CONFIRMED without a tx_hash must be rejected by the DB.
      await expect(
        prisma.payment.update({
          where: { id: payment.id },
          data: { status: "CONFIRMED" },
        }),
      ).rejects.toBeTruthy();
    });
  },
);
