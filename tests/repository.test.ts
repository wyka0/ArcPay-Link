import { describe, expect, it } from "vitest";

import { createInMemoryPaymentRepository } from "@/lib/payments/memory-repository";
import { TransactionAlreadyClaimedError } from "@/lib/payments/repository";

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const PAYER = "0x3333333333333333333333333333333333333333";
const TX_HASH = `0x${"ab".repeat(32)}`;

const INPUT = {
  amountUsdc: "5.000000",
  amountBaseUnits: "5000000",
  description: "Design work",
  recipient: RECIPIENT as `0x${string}`,
};

describe("InMemoryPaymentRepository", () => {
  it("creates payments as PENDING", async () => {
    const repo = createInMemoryPaymentRepository();
    const payment = await repo.create(INPUT);
    expect(payment.status).toBe("PENDING");
    expect(payment.id).toBeTruthy();
    expect(payment.amountUsdc).toBe("5.000000");
  });

  it("claims a transaction and marks the payment CONFIRMED", async () => {
    const repo = createInMemoryPaymentRepository();
    const payment = await repo.create(INPUT);

    const confirmed = await repo.claim(payment.id, {
      txHash: TX_HASH,
      payer: PAYER,
    });

    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.txHash).toBe(TX_HASH);
    expect(confirmed.payer).toBe(PAYER);
    expect(confirmed.confirmedAt).toBeTruthy();
  });

  it("reports the claiming payment for a transaction hash", async () => {
    const repo = createInMemoryPaymentRepository();
    const payment = await repo.create(INPUT);
    await repo.claim(payment.id, { txHash: TX_HASH, payer: PAYER });

    expect(await repo.findClaimingPaymentId(TX_HASH)).toBe(payment.id);
    expect(await repo.findClaimingPaymentId(TX_HASH.toUpperCase())).toBe(
      payment.id,
    );
  });

  it("rejects reusing one transaction for a second payment", async () => {
    const repo = createInMemoryPaymentRepository();
    const first = await repo.create(INPUT);
    const second = await repo.create(INPUT);

    await repo.claim(first.id, { txHash: TX_HASH, payer: PAYER });

    await expect(
      repo.claim(second.id, { txHash: TX_HASH, payer: PAYER }),
    ).rejects.toThrow(TransactionAlreadyClaimedError);
    expect((await repo.getById(second.id))?.status).toBe("PENDING");
  });

  it("treats re-claiming the same payment with the same hash as idempotent", async () => {
    const repo = createInMemoryPaymentRepository();
    const payment = await repo.create(INPUT);

    await repo.claim(payment.id, { txHash: TX_HASH, payer: PAYER });
    const again = await repo.claim(payment.id, {
      txHash: TX_HASH,
      payer: PAYER,
    });

    expect(again.status).toBe("CONFIRMED");
  });
});
