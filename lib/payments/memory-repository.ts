import {
  normalizeTxHash,
  PaymentNotFoundError,
  type PaymentRepository,
  TransactionAlreadyClaimedError,
} from "./repository";
import type { Payment } from "./types";
import type { CreatePaymentInput } from "./validation";

interface MemoryStore {
  payments: Map<string, Payment>;
  txClaims: Map<string, string>;
}

/**
 * In-memory repository used by unit tests. It mirrors the durable repository's
 * semantics (idempotent same-payment claim, conflict for a different payment)
 * but provides no durability. Production uses `SqlitePaymentRepository`.
 */
export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly store: MemoryStore;

  constructor(store?: MemoryStore) {
    this.store = store ?? {
      payments: new Map<string, Payment>(),
      txClaims: new Map<string, string>(),
    };
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
    this.store.payments.set(payment.id, payment);
    return payment;
  }

  async getById(id: string): Promise<Payment | null> {
    return this.store.payments.get(id) ?? null;
  }

  async list(): Promise<Payment[]> {
    return Array.from(this.store.payments.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async findClaimingPaymentId(txHash: string): Promise<string | null> {
    return this.store.txClaims.get(normalizeTxHash(txHash)) ?? null;
  }

  async claim(
    id: string,
    claim: { txHash: string; payer: string },
  ): Promise<Payment> {
    const payment = this.store.payments.get(id);
    if (!payment) {
      throw new PaymentNotFoundError(id);
    }

    const key = normalizeTxHash(claim.txHash);
    const existingClaim = this.store.txClaims.get(key);
    if (existingClaim && existingClaim !== id) {
      throw new TransactionAlreadyClaimedError(claim.txHash);
    }

    this.store.txClaims.set(key, id);

    const confirmed: Payment = {
      ...payment,
      status: "CONFIRMED",
      txHash: key,
      payer: claim.payer,
      confirmedAt: new Date().toISOString(),
    };
    this.store.payments.set(id, confirmed);
    return confirmed;
  }
}

/** Fresh, isolated repository. */
export function createInMemoryPaymentRepository(): PaymentRepository {
  return new InMemoryPaymentRepository();
}
