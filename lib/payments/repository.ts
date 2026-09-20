import type { CreatePaymentInput } from "./validation";
import type { Payment } from "./types";

/**
 * Payment persistence contract.
 *
 * Implementations must guarantee that a transaction hash can be claimed by at
 * most one payment, atomically. See `sqlite-repository.ts` for the durable
 * implementation where the guarantee is enforced by a database constraint.
 */
export interface PaymentRepository {
  create(input: CreatePaymentInput): Promise<Payment>;
  getById(id: string): Promise<Payment | null>;
  list(): Promise<Payment[]>;
  /** Id of the payment that already claimed `txHash`, or null. */
  findClaimingPaymentId(txHash: string): Promise<string | null>;
  /**
   * Atomically mark a payment CONFIRMED with its transaction hash.
   *
   * - first claim for a hash succeeds,
   * - re-claiming the same payment with the same hash is idempotent,
   * - claiming a hash already owned by another payment throws
   *   `TransactionAlreadyClaimedError`.
   */
  claim(id: string, claim: { txHash: string; payer: string }): Promise<Payment>;
}

export class TransactionAlreadyClaimedError extends Error {
  constructor(txHash: string) {
    super(`Transaction ${txHash} is already claimed by another payment`);
    this.name = "TransactionAlreadyClaimedError";
  }
}

export class PaymentNotFoundError extends Error {
  constructor(id: string) {
    super(`Payment ${id} not found`);
    this.name = "PaymentNotFoundError";
  }
}

/** Normalise a transaction hash for storage and comparison. */
export function normalizeTxHash(txHash: string): string {
  return txHash.toLowerCase();
}
