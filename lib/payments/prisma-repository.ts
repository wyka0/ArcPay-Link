import type { PrismaClient } from "@/lib/generated/prisma/client";

import {
  normalizeTxHash,
  PaymentNotFoundError,
  type PaymentRepository,
  TransactionAlreadyClaimedError,
} from "./repository";
import type { Payment, PaymentStatus } from "./types";
import type { CreatePaymentInput } from "./validation";

/** Shape of a `payments` row as returned by Prisma. */
interface PaymentRecord {
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

function toPayment(record: PaymentRecord): Payment {
  return {
    id: record.id,
    amountUsdc: record.amountUsdc,
    amountBaseUnits: record.amountBaseUnits,
    recipient: record.recipient,
    description: record.description,
    status: record.status as PaymentStatus,
    txHash: record.txHash ?? undefined,
    payer: record.payer ?? undefined,
    createdAt: record.createdAt,
    confirmedAt: record.confirmedAt ?? undefined,
  };
}

/**
 * True when Prisma reports a unique-constraint violation.
 *
 * Prisma surfaces PostgreSQL `23505` as error code `P2002`. The raw database
 * error name is also checked as a fallback.
 */
export function isPrismaUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "P2002") return true;
  return (
    typeof candidate.message === "string" && candidate.message.includes("23505")
  );
}

/**
 * Durable PostgreSQL payment repository (Neon).
 *
 * The interface and semantics are identical to the verified SQLite
 * implementation. Replay protection is enforced by two database constraints:
 *
 *   1. `tx_claims.tx_hash` PRIMARY KEY — a hash can be claimed once.
 *   2. `payments.tx_hash` UNIQUE (nullable) — one payment per hash; PostgreSQL
 *      allows many NULLs, matching the previous partial unique index.
 *
 * The claim runs inside a single database transaction. If two writers race,
 * one commits and the loser receives a unique-constraint error, which is mapped
 * to `TransactionAlreadyClaimedError` (or to an idempotent success when the same
 * payment already owns the hash). The database, not application code, is the
 * final protection.
 */
export class PrismaPaymentRepository implements PaymentRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
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

    await this.prisma.payment.create({
      data: {
        id: payment.id,
        amountUsdc: payment.amountUsdc,
        amountBaseUnits: payment.amountBaseUnits,
        recipient: payment.recipient,
        description: payment.description,
        status: payment.status,
        createdAt: payment.createdAt,
      },
    });

    return payment;
  }

  async getById(id: string): Promise<Payment | null> {
    const record = await this.prisma.payment.findUnique({ where: { id } });
    return record ? toPayment(record) : null;
  }

  async list(): Promise<Payment[]> {
    const records = await this.prisma.payment.findMany({
      orderBy: { createdAt: "desc" },
    });
    return records.map(toPayment);
  }

  async findClaimingPaymentId(txHash: string): Promise<string | null> {
    const record = await this.prisma.txClaim.findUnique({
      where: { txHash: normalizeTxHash(txHash) },
    });
    return record ? record.paymentId : null;
  }

  async claim(
    id: string,
    claim: { txHash: string; payer: string },
  ): Promise<Payment> {
    const key = normalizeTxHash(claim.txHash);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.payment.findUnique({ where: { id } });
        if (!existing) {
          throw new PaymentNotFoundError(id);
        }

        // Idempotent: this payment already owns this exact transaction.
        if (existing.status === "CONFIRMED") {
          if (existing.txHash && normalizeTxHash(existing.txHash) === key) {
            return toPayment(existing);
          }
          throw new TransactionAlreadyClaimedError(claim.txHash);
        }

        const owner = await tx.txClaim.findUnique({ where: { txHash: key } });
        if (owner && owner.paymentId !== id) {
          throw new TransactionAlreadyClaimedError(claim.txHash);
        }

        const now = new Date().toISOString();

        // The PRIMARY KEY constraint is the atomic guard: a concurrent insert
        // for the same hash fails here even if the SELECT above saw no owner.
        await tx.txClaim.create({
          data: { txHash: key, paymentId: id, claimedAt: now },
        });

        // The UNIQUE index on payments.tx_hash guards the second layer.
        const updated = await tx.payment.update({
          where: { id },
          data: {
            status: "CONFIRMED",
            txHash: key,
            payer: claim.payer,
            confirmedAt: now,
          },
        });

        return toPayment(updated);
      });
    } catch (error) {
      if (
        error instanceof PaymentNotFoundError ||
        error instanceof TransactionAlreadyClaimedError
      ) {
        throw error;
      }

      if (isPrismaUniqueViolation(error)) {
        // A concurrent writer may have committed the same claim first. If it
        // was this same payment, the operation is idempotent; otherwise it is a
        // replay by another payment.
        const current = await this.getById(id);
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
}

export function createPrismaPaymentRepository(
  prisma: PrismaClient,
): PrismaPaymentRepository {
  return new PrismaPaymentRepository(prisma);
}
