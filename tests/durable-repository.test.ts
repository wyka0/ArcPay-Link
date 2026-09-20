import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { openDatabase } from "@/lib/payments/database";
import { TransactionAlreadyClaimedError } from "@/lib/payments/repository";
import { createSqlitePaymentRepository } from "@/lib/payments/sqlite-repository";

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const PAYER = "0x3333333333333333333333333333333333333333";
const TX_HASH = `0x${"ab".repeat(32)}`;

const INPUT = {
  amountUsdc: "5.000000",
  amountBaseUnits: "5000000",
  description: "Design work",
  recipient: RECIPIENT as `0x${string}`,
};

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "arcpay-durable-"));
  tempDirs.push(dir);
  return join(dir, "payments.db");
}

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly hold the WAL file; cleanup is best effort.
    }
  }
});

function runClaimWorker(data: {
  dbPath: string;
  paymentId: string;
  txHash: string;
}): Promise<{ paymentId: string; ok: boolean; code: string | null }> {
  const workerPath = fileURLToPath(
    new URL("./helpers/claim-worker.mjs", import.meta.url),
  );
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: data });
    worker.once("message", (message) => resolve(message));
    worker.once("error", reject);
  });
}

describe("SqlitePaymentRepository durability", () => {
  it("persists a payment across separate connections", async () => {
    const dbPath = tempDbPath();

    const db1 = openDatabase(dbPath);
    const created = await createSqlitePaymentRepository(db1).create(INPUT);
    db1.close();

    const db2 = openDatabase(dbPath);
    const reloaded = await createSqlitePaymentRepository(db2).getById(
      created.id,
    );
    db2.close();

    expect(reloaded?.id).toBe(created.id);
    expect(reloaded?.amountBaseUnits).toBe("5000000");
    expect(reloaded?.status).toBe("PENDING");
  });

  it("enforces one payment per transaction hash and is idempotent", async () => {
    const db = openDatabase(tempDbPath());
    const repo = createSqlitePaymentRepository(db);

    const first = await repo.create(INPUT);
    const second = await repo.create(INPUT);

    const confirmed = await repo.claim(first.id, {
      txHash: TX_HASH,
      payer: PAYER,
    });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.txHash).toBe(TX_HASH);

    await expect(
      repo.claim(second.id, { txHash: TX_HASH, payer: PAYER }),
    ).rejects.toThrow(TransactionAlreadyClaimedError);
    expect((await repo.getById(second.id))?.status).toBe("PENDING");

    const again = await repo.claim(first.id, {
      txHash: TX_HASH.toUpperCase(),
      payer: PAYER,
    });
    expect(again.status).toBe("CONFIRMED");

    expect(await repo.findClaimingPaymentId(TX_HASH)).toBe(first.id);

    db.close();
  });

  it("runs the claim as a single transaction (no partial state)", async () => {
    const db = openDatabase(tempDbPath());
    const repo = createSqlitePaymentRepository(db);
    const payment = await repo.create(INPUT);

    await expect(
      repo.claim("unknown-payment-id", { txHash: TX_HASH, payer: PAYER }),
    ).rejects.toThrow();

    // The failed claim must not leave a dangling tx_claims row.
    expect(await repo.findClaimingPaymentId(TX_HASH)).toBeNull();
    expect((await repo.getById(payment.id))?.status).toBe("PENDING");

    db.close();
  });
});

describe("SqlitePaymentRepository database constraints", () => {
  it("rejects duplicate tx hashes at the database level", async () => {
    const db = openDatabase(tempDbPath());
    const repo = createSqlitePaymentRepository(db);
    const first = await repo.create(INPUT);
    const second = await repo.create(INPUT);
    const now = new Date().toISOString();

    // tx_claims.tx_hash PRIMARY KEY
    const insertClaim = db.prepare(
      `INSERT INTO tx_claims (tx_hash, payment_id, claimed_at) VALUES (?, ?, ?)`,
    );
    insertClaim.run(TX_HASH, first.id, now);
    expect(() => insertClaim.run(TX_HASH, second.id, now)).toThrow(
      /UNIQUE|PRIMARY/i,
    );

    // payments.tx_hash partial UNIQUE index
    const confirm = db.prepare(
      `UPDATE payments SET status = 'CONFIRMED', tx_hash = ?, confirmed_at = ? WHERE id = ?`,
    );
    confirm.run(TX_HASH, now, first.id);
    expect(() => confirm.run(TX_HASH, now, second.id)).toThrow(
      /UNIQUE|PRIMARY/i,
    );

    db.close();
  });
});

describe("SqlitePaymentRepository concurrency", () => {
  it("lets exactly one of two concurrent connections claim a hash", async () => {
    const dbPath = tempDbPath();

    const dbA = openDatabase(dbPath);
    const dbB = openDatabase(dbPath);
    const repoA = createSqlitePaymentRepository(dbA);
    const repoB = createSqlitePaymentRepository(dbB);

    const paymentA = await repoA.create(INPUT);
    const paymentB = await repoA.create(INPUT);

    const results = await Promise.allSettled([
      repoA.claim(paymentA.id, { txHash: TX_HASH, payer: PAYER }),
      repoB.claim(paymentB.id, { txHash: TX_HASH, payer: PAYER }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      TransactionAlreadyClaimedError,
    );

    const statuses = [
      (await repoA.getById(paymentA.id))?.status,
      (await repoA.getById(paymentB.id))?.status,
    ];
    expect(statuses.filter((status) => status === "CONFIRMED")).toHaveLength(1);

    dbA.close();
    dbB.close();
  });

  it("rejects concurrent claims from separate worker threads", async () => {
    const dbPath = tempDbPath();

    const db = openDatabase(dbPath);
    const repo = createSqlitePaymentRepository(db);
    const paymentA = await repo.create(INPUT);
    const paymentB = await repo.create(INPUT);
    db.close();

    const jobs = Array.from({ length: 8 }, (_value, index) =>
      runClaimWorker({
        dbPath,
        paymentId: index % 2 === 0 ? paymentA.id : paymentB.id,
        txHash: TX_HASH,
      }),
    );

    const results = await Promise.all(jobs);

    const winners = results.filter((result) => result.ok);
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(7);

    const verifyDb = openDatabase(dbPath);
    const verifyRepo = createSqlitePaymentRepository(verifyDb);

    const statuses = [
      (await verifyRepo.getById(paymentA.id))?.status,
      (await verifyRepo.getById(paymentB.id))?.status,
    ];
    expect(statuses.filter((status) => status === "CONFIRMED")).toHaveLength(1);
    expect(await verifyRepo.findClaimingPaymentId(TX_HASH)).toBe(
      winners[0].paymentId,
    );

    verifyDb.close();
  });

  it("treats concurrent claims of the same payment as idempotent", async () => {
    const dbPath = tempDbPath();

    const dbA = openDatabase(dbPath);
    const dbB = openDatabase(dbPath);
    const repoA = createSqlitePaymentRepository(dbA);
    const repoB = createSqlitePaymentRepository(dbB);

    const payment = await repoA.create(INPUT);

    const results = await Promise.allSettled([
      repoA.claim(payment.id, { txHash: TX_HASH, payer: PAYER }),
      repoB.claim(payment.id, { txHash: TX_HASH, payer: PAYER }),
    ]);

    // Both observe the same owner. One confirms; the other either confirms
    // idempotently or is rejected, but never corrupts state.
    const settled = results.filter((result) => result.status === "fulfilled");
    expect(settled.length).toBeGreaterThanOrEqual(1);
    expect(
      results.every(
        (result) =>
          result.status === "fulfilled" ||
          result.reason instanceof TransactionAlreadyClaimedError,
      ),
    ).toBe(true);

    expect((await repoA.getById(payment.id))?.status).toBe("CONFIRMED");
    expect(await repoA.findClaimingPaymentId(TX_HASH)).toBe(payment.id);

    dbA.close();
    dbB.close();
  });
});
