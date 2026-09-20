/**
 * Payment domain model.
 *
 * USDC amounts are never stored as JavaScript numbers. `amountUsdc` is the
 * canonical decimal string (for example "5.00") and `amountBaseUnits` is the
 * exact 6-decimal integer representation as a string (for example "5000000").
 */
export type PaymentStatus = "PENDING" | "CONFIRMED" | "EXPIRED";

export interface Payment {
  id: string;
  /** Canonical decimal USDC string, e.g. "5.00". */
  amountUsdc: string;
  /** Exact base units (6 decimals) as a decimal string, e.g. "5000000". */
  amountBaseUnits: string;
  recipient: string;
  description: string;
  status: PaymentStatus;
  txHash?: string;
  payer?: string;
  createdAt: string;
  confirmedAt?: string;
}

/** Payment payload returned to the browser. Never includes secrets. */
export interface PublicPayment {
  id: string;
  amountUsdc: string;
  recipient: string;
  description: string;
  status: PaymentStatus;
  txHash?: string;
  payer?: string;
  createdAt: string;
  confirmedAt?: string;
}

export function toPublicPayment(payment: Payment): PublicPayment {
  return {
    id: payment.id,
    amountUsdc: payment.amountUsdc,
    recipient: payment.recipient,
    description: payment.description,
    status: payment.status,
    txHash: payment.txHash,
    payer: payment.payer,
    createdAt: payment.createdAt,
    confirmedAt: payment.confirmedAt,
  };
}
