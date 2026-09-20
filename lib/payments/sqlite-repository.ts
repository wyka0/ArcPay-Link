import type Database from "better-sqlite3";

import { isUniqueConstraintError } from "./database";
import { type PaymentRow, rowToPayment } from "./sqlite-mapping";
import {
  normalizeTxHash,
  PaymentNotFoundError,
  type PaymentRepository,
  TransactionAlreadyClaimedError,
} from "./repository";
import type { Payment } from "./types";
import type { CreatePaymentInput } from "./validation";

/**
 * Durable SQLite payment repository.
 *
 * Replay protection is enforced in two layers, both at the database level:
 *
 *   1. `tx_claims.tx_hash` is a PRIMARY KEY, so a hash can be inserted once.
 *   2. `payments.tx_hash` has a partial UNIQUE index.
 *
 * The claim runs inside a single SQLite transaction. If two connections race,
 * one INSERT/UPDATE wins and the loser gets a SQLITE_CONSTRAINT error, which is
 * mapped to `TransactionAlreadyClaimedError`. The database, not application
 * code, is the final protection.
 */
export class SqlitePaymentRepository implements PaymentRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async create(input: CreatePaymentInput): Promise<Payment> {
    const payment: Payment = {
      id: globalThis.crypto.randomUUID(),
      amountUsdc: input.amountUsdc,
      amountBaseUnits: input.amountBaseUnits,
      recipient: input.recipient,
      description: input.description,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO payments
           (id, amount_usdc, amount_base_units, recipient, description, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payment.id,
        payment.amountUsdc,
        payment.amountBaseUnits,
        payment.recipient,
        payment.description,
        payment.status,
        payment.createdAt,
      );

    return payment;
  }

  async getById(id: string): Promise<Payment | null> {
    return this.readRow(id);
  }

  async list(): Promise<Payment[]> {
    const rows = this.db
      .prepare(`SELECT * FROM payments ORDER BY created_at DESC`)
      .all() as PaymentRow[];
    return rows.map(rowToPayment);
  }

  async findClaimingPaymentId(txHash: string): Promise<string | null> {
    const row = this.db
      .prepare(`SELECT payment_id FROM tx_claims WHERE tx_hash = ?`)
      .get(normalizeTxHash(txHash)) as { payment_id: string } | undefined;
    return row ? row.payment_id : null;
  }

  async claim(
    id: string,
    claim: { txHash: string; payer: string },
  ): Promise<Payment> {
    const key = normalizeTxHash(claim.txHash);

    const runClaim = this.db.transaction((): Payment => {
      const existing = this.readRow(id);
      if (!existing) {
        throw new PaymentNotFoundError(id);
      }

      // Idempotent: this payment already owns this exact transaction.
      if (existing.status === "CONFIRMED") {
        if (existing.txHash && normalizeTxHash(existing.txHash) === key) {
          return existing;
        }
        throw new TransactionAlreadyClaimedError(claim.txHash);
      }

      const owner = this.db
        .prepare(`SELECT payment_id FROM tx_claims WHERE tx_hash = ?`)
        .get(key) as { payment_id: string } | undefined;
      if (owner && owner.payment_id !== id) {
        throw new TransactionAlreadyClaimedError(claim.txHash);
      }

      const now = new Date().toISOString();

      // The PRIMARY KEY constraint is the atomic guard: a concurrent insert for
      // the same hash fails here even if the SELECT above saw no owner.
      this.db
        .prepare(
          `INSERT INTO tx_claims (tx_hash, payment_id, claimed_at) VALUES (?, ?, ?)`,
        )
        .run(key, id, now);

      // The partial UNIQUE index on payments.tx_hash guards this second layer.
      this.db
        .prepare(
          `UPDATE payments
             SET status = 'CONFIRMED', tx_hash = ?, payer = ?, confirmed_at = ?
           WHERE id = ?`,
        )
        .run(key, claim.payer, now, id);

      const updated = this.readRow(id);
      if (!updated) {
        throw new PaymentNotFoundError(id);
      }
      return updated;
    });

    try {
      return runClaim();
    } catch (error) {
      if (
        error instanceof PaymentNotFoundError ||
        error instanceof TransactionAlreadyClaimedError
      ) {
        throw error;
      }
      if (isUniqueConstraintError(error)) {
        // A concurrent writer may have committed the same claim first. If it was
        // this same payment, the operation is idempotent; otherwise it is a
        // replay by another payment.
        const current = this.readRow(id);
        if (
          current &&
          current.status === "CONFIRMED" &&
          current.txHash &&
          normalizeTxHash(current.txHash) === key
        ) {
          return current;
        }
        throw new TransactionAlreadyClaimedError(claim.txHash);
      }
      throw error;
    }
  }

  private readRow(id: string): Payment | null {
    const row = this.db
      .prepare(`SELECT * FROM payments WHERE id = ?`)
      .get(id) as PaymentRow | undefined;
    return row ? rowToPayment(row) : null;
  }
}

export function createSqlitePaymentRepository(
  db: Database.Database,
): SqlitePaymentRepository {
  return new SqlitePaymentRepository(db);
}
