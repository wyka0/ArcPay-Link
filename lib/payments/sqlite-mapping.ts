import type { Payment, PaymentStatus } from "./types";

/** Row shape of the `payments` table. */
export interface PaymentRow {
  id: string;
  amount_usdc: string;
  amount_base_units: string;
  recipient: string;
  description: string;
  status: PaymentStatus;
  tx_hash: string | null;
  payer: string | null;
  created_at: string;
  confirmed_at: string | null;
}

/** Map a database row to the domain model. Nullable columns become optional. */
export function rowToPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    amountUsdc: row.amount_usdc,
    amountBaseUnits: row.amount_base_units,
    recipient: row.recipient,
    description: row.description,
    status: row.status,
    txHash: row.tx_hash ?? undefined,
    payer: row.payer ?? undefined,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
  };
}
