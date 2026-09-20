import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/lib/generated/prisma/client";
import {
  createPrismaPaymentRepository,
  isPrismaUniqueViolation,
} from "@/lib/payments/prisma-repository";
import {
  PaymentNotFoundError,
  TransactionAlreadyClaimedError,
} from "@/lib/payments/repository";

import { FakePrisma } from "./helpers/fake-prisma";

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const PAYER = "0x3333333333333333333333333333333333333333";
const TX_HASH = `0x${"ab".repeat(32)}`;
const OTHER_TX = `0x${"cd".repeat(32)}`;

const INPUT = {
  amountUsdc: "5.000000",
  amountBaseUnits: "5000000",
  description: "Design work",
  recipient: RECIPIENT as `0x${string}`,
};

function setup() {
  const fake = new FakePrisma();
  const repo = createPrismaPaymentRepository(fake as unknown as PrismaClient);
  return { fake, repo };
}

describe("PrismaPaymentRepository", () => {
  it("A. creates a PENDING payment", async () => {
    const { repo } = setup();
    const payment = await repo.create(INPUT);
    expect(payment.status).toBe("PENDING");
    expect(payment.amountUsdc).toBe("5.000000");
    expect(payment.amountBaseUnits).toBe("5000000");
    expect(payment.id).toBeTruthy();
    expect(payment.txHash).toBeUndefined();
  });

  it("B. retrieves a payment by id", async () => {
    const { repo } = setup();
    const created = await repo.create(INPUT);
    const found = await repo.getById(created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.recipient).toBe(RECIPIENT);
    expect(await repo.getById("missing")).toBeNull();
  });

  it("B. lists payments newest first", async () => {
    const { repo } = setup();
    await repo.create(INPUT);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await repo.create(INPUT);
    const listed = await repo.list();
    expect(listed).toHaveLength(2);
    expect(listed[0].id).toBe(second.id);
  });

  it("C. updates a payment when claimed", async () => {
    const { repo } = setup();
    const payment = await repo.create(INPUT);
    const confirmed = await repo.claim(payment.id, {
      txHash: TX_HASH,
      payer: PAYER,
    });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.txHash).toBe(TX_HASH.toLowerCase());
    expect(confirmed.payer).toBe(PAYER);
    expect(confirmed.confirmedAt).toBeTruthy();
    expect((await repo.getById(payment.id))?.status).toBe("CONFIRMED");
  });

  it("D. first tx claim succeeds and is recorded", async () => {
    const { repo } = setup();
    const payment = await repo.create(INPUT);
    await repo.claim(payment.id, { txHash: TX_HASH, payer: PAYER });
    expect(await repo.findClaimingPaymentId(TX_HASH)).toBe(payment.id);
    expect(await repo.findClaimingPaymentId(TX_HASH.toUpperCase())).toBe(
      payment.id,
    );
  });

  it("E. same payment + same tx hash is idempotent", async () => {
    const { repo } = setup();
    const payment = await repo.create(INPUT);
    await repo.claim(payment.id, { txHash: TX_HASH, payer: PAYER });
    const again = await repo.claim(payment.id, {
      txHash: TX_HASH.toUpperCase(),
      payer: PAYER,
    });
    expect(again.status).toBe("CONFIRMED");
    expect(again.txHash).toBe(TX_HASH.toLowerCase());
  });

  it("F. different payment + same tx hash is rejected", async () => {
    const { repo } = setup();
    const first = await repo.create(INPUT);
    const second = await repo.create(INPUT);
    await repo.claim(first.id, { txHash: TX_HASH, payer: PAYER });

    await expect(
      repo.claim(second.id, { txHash: TX_HASH, payer: PAYER }),
    ).rejects.toThrow(TransactionAlreadyClaimedError);
    expect((await repo.getById(second.id))?.status).toBe("PENDING");
    expect((await repo.getById(first.id))?.status).toBe("CONFIRMED");
  });

  it("F. a confirmed payment rejects a different tx hash", async () => {
    const { repo } = setup();
    const payment = await repo.create(INPUT);
    await repo.claim(payment.id, { txHash: TX_HASH, payer: PAYER });
    await expect(
      repo.claim(payment.id, { txHash: OTHER_TX, payer: PAYER }),
    ).rejects.toThrow(TransactionAlreadyClaimedError);
  });

  it("G. concurrent claims of one hash cannot create two owners", async () => {
    const { repo } = setup();
    const a = await repo.create(INPUT);
    const b = await repo.create(INPUT);

    const results = await Promise.allSettled([
      repo.claim(a.id, { txHash: TX_HASH, payer: PAYER }),
      repo.claim(b.id, { txHash: TX_HASH, payer: PAYER }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const statuses = [
      (await repo.getById(a.id))?.status,
      (await repo.getById(b.id))?.status,
    ];
    expect(statuses.filter((s) => s === "CONFIRMED")).toHaveLength(1);

    const owner = await repo.findClaimingPaymentId(TX_HASH);
    expect([a.id, b.id]).toContain(owner);
  });

  it("G. concurrent claims of the same payment stay consistent", async () => {
    const { repo } = setup();
    const payment = await repo.create(INPUT);

    const results = await Promise.allSettled([
      repo.claim(payment.id, { txHash: TX_HASH, payer: PAYER }),
      repo.claim(payment.id, { txHash: TX_HASH, payer: PAYER }),
    ]);

    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect((await repo.getById(payment.id))?.status).toBe("CONFIRMED");
    expect(await repo.findClaimingPaymentId(TX_HASH)).toBe(payment.id);
  });

  it("rolls back the claim when a constraint fails", async () => {
    const { fake, repo } = setup();
    const payment = await repo.create(INPUT);

    // Another payment already owns this hash at the payments layer, but there
    // is no tx_claims row, so the claim proceeds to commit and must fail.
    fake.seedPayment({
      id: "external-owner",
      amountUsdc: "1.000000",
      amountBaseUnits: "1000000",
      recipient: RECIPIENT,
      description: "external",
      status: "CONFIRMED",
      txHash: TX_HASH.toLowerCase(),
      payer: PAYER,
      failureReason: null,
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
    });

    await expect(
      repo.claim(payment.id, { txHash: TX_HASH, payer: PAYER }),
    ).rejects.toThrow(TransactionAlreadyClaimedError);

    // Nothing from the failed transaction may remain.
    expect(await repo.findClaimingPaymentId(TX_HASH)).toBeNull();
    expect((await repo.getById(payment.id))?.status).toBe("PENDING");
  });

  it("throws PaymentNotFoundError for an unknown payment", async () => {
    const { repo } = setup();
    await expect(
      repo.claim("nope", { txHash: TX_HASH, payer: PAYER }),
    ).rejects.toThrow(PaymentNotFoundError);
  });

  it("recognises Prisma unique-violation errors", () => {
    expect(isPrismaUniqueViolation({ code: "P2002" })).toBe(true);
    expect(
      isPrismaUniqueViolation({ message: "duplicate key value (23505)" }),
    ).toBe(true);
    expect(isPrismaUniqueViolation(new Error("other"))).toBe(false);
    expect(isPrismaUniqueViolation(null)).toBe(false);
  });
});
