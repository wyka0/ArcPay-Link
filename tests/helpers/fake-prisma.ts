/**
 * In-memory double for PrismaClient with realistic transaction semantics.
 *
 * It models the two database behaviours the Prisma repository depends on:
 *
 *   1. `tx_claims.tx_hash` PRIMARY KEY uniqueness
 *   2. `payments.tx_hash` UNIQUE (nullable)
 *
 * Each `$transaction` buffers its writes locally and validates them against the
 * committed state at commit time — like PostgreSQL, where concurrent writers do
 * not observe each other's uncommitted rows and the loser of a unique-key race
 * fails at write/commit. This exercises the repository's unique-violation
 * handling (P2002) rather than an application-level pre-check.
 */

export interface PaymentRow {
  id: string;
  amountUsdc: string;
  amountBaseUnits: string;
  recipient: string;
  description: string;
  status: string;
  txHash: string | null;
  payer: string | null;
  failureReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface ClaimRow {
  txHash: string;
  paymentId: string;
  claimedAt: string;
}

export function uniqueViolation(): Error {
  const error = new Error("Unique constraint failed on the fields (23505)");
  (error as { code?: string }).code = "P2002";
  return error;
}

const clone = <T>(value: T): T =>
  value === null || value === undefined ? value : ({ ...value } as T);

class FakeTransaction {
  private readonly pendingPayments = new Map<string, PaymentRow>();
  private readonly pendingClaims = new Map<string, ClaimRow>();

  constructor(private readonly db: FakePrisma) {}

  private readPayment(id: string): PaymentRow | null {
    return (
      this.pendingPayments.get(id) ?? this.db.committedPayments.get(id) ?? null
    );
  }

  private readClaim(key: string): ClaimRow | null {
    return (
      this.pendingClaims.get(key) ?? this.db.committedClaims.get(key) ?? null
    );
  }

  payment = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      clone(this.readPayment(where.id)),
    findMany: async (args?: { orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const merged = new Map(this.db.committedPayments);
      for (const [id, row] of this.pendingPayments) merged.set(id, row);
      const rows = [...merged.values()].map((r) => ({ ...r }));
      if (args?.orderBy?.createdAt === "desc") {
        rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }
      return rows;
    },
    create: async ({ data }: { data: PaymentRow }) => {
      if (this.readPayment(data.id)) throw uniqueViolation();
      const row: PaymentRow = {
        id: data.id,
        amountUsdc: data.amountUsdc,
        amountBaseUnits: data.amountBaseUnits,
        recipient: data.recipient,
        description: data.description,
        status: data.status,
        createdAt: data.createdAt,
        txHash: data.txHash ?? null,
        payer: data.payer ?? null,
        failureReason: data.failureReason ?? null,
        confirmedAt: data.confirmedAt ?? null,
      };
      this.pendingPayments.set(row.id, row);
      return { ...row };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<PaymentRow>;
    }) => {
      const row = this.readPayment(where.id);
      if (!row) throw new Error(`payment ${where.id} not found`);
      const next = { ...row, ...data };
      this.pendingPayments.set(next.id, next);
      return { ...next };
    },
  };

  txClaim = {
    findUnique: async ({ where }: { where: { txHash: string } }) =>
      clone(this.readClaim(where.txHash)),
    create: async ({ data }: { data: ClaimRow }) => {
      if (this.readClaim(data.txHash)) throw uniqueViolation();
      this.pendingClaims.set(data.txHash, { ...data });
      return { ...data };
    },
  };

  /**
   * Validate all buffered writes against the committed state, then apply them.
   * If any check fails nothing is applied (transaction rollback).
   */
  commit(): void {
    for (const key of this.pendingClaims.keys()) {
      if (this.db.committedClaims.has(key)) throw uniqueViolation();
    }
    for (const [id, row] of this.pendingPayments) {
      if (row.txHash === null) continue;
      for (const [otherId, other] of this.db.committedPayments) {
        if (otherId !== id && other.txHash === row.txHash) {
          throw uniqueViolation();
        }
      }
    }

    for (const [key, row] of this.pendingClaims) {
      this.db.committedClaims.set(key, row);
    }
    for (const [id, row] of this.pendingPayments) {
      this.db.committedPayments.set(id, row);
    }
  }
}

export class FakePrisma {
  readonly committedPayments = new Map<string, PaymentRow>();
  readonly committedClaims = new Map<string, ClaimRow>();

  $transaction = async <T>(
    fn: (tx: FakeTransaction) => Promise<T>,
  ): Promise<T> => {
    const tx = new FakeTransaction(this);
    const result = await fn(tx);
    tx.commit();
    return result;
  };

  payment = {
    create: async ({ data }: { data: PaymentRow }) => {
      const row: PaymentRow = {
        id: data.id,
        amountUsdc: data.amountUsdc,
        amountBaseUnits: data.amountBaseUnits,
        recipient: data.recipient,
        description: data.description,
        status: data.status,
        createdAt: data.createdAt,
        txHash: data.txHash ?? null,
        payer: data.payer ?? null,
        failureReason: data.failureReason ?? null,
        confirmedAt: data.confirmedAt ?? null,
      };
      if (this.committedPayments.has(row.id)) throw uniqueViolation();
      this.committedPayments.set(row.id, row);
      return { ...row };
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      clone(this.committedPayments.get(where.id) ?? null),
    findMany: async (args?: { orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = [...this.committedPayments.values()].map((r) => ({ ...r }));
      if (args?.orderBy?.createdAt === "desc") {
        rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }
      return rows;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<PaymentRow>;
    }) => {
      const row = this.committedPayments.get(where.id);
      if (!row) throw new Error(`payment ${where.id} not found`);
      const next = { ...row, ...data };
      this.committedPayments.set(next.id, next);
      return { ...next };
    },
  };

  txClaim = {
    create: async ({ data }: { data: ClaimRow }) => {
      if (this.committedClaims.has(data.txHash)) throw uniqueViolation();
      this.committedClaims.set(data.txHash, { ...data });
      return { ...data };
    },
    findUnique: async ({ where }: { where: { txHash: string } }) =>
      clone(this.committedClaims.get(where.txHash) ?? null),
  };

  /** Seed a committed payment (test setup only). */
  seedPayment(row: PaymentRow): void {
    this.committedPayments.set(row.id, { ...row });
  }

  /** Seed a committed claim (test setup only). */
  seedClaim(row: ClaimRow): void {
    this.committedClaims.set(row.txHash, { ...row });
  }
}
