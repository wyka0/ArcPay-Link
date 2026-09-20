import {
  parseEventLogs,
  type Address,
  type Log,
  type TransactionReceipt,
} from "viem";

import type { Payment } from "@/lib/payments/types";

import {
  ARC_MAINNET_CHAIN_ID,
  getArcUsdcAddress,
  PAYMENT_TRANSFER_TOLERANCE_SECONDS,
} from "./config";
import { getArcPublicClient } from "./client";
import { erc20Abi, formatUsdcAmount, parseUsdcAmount } from "./usdc";

/**
 * Independent on-chain verification boundary.
 *
 * A payment may only move from PENDING to CONFIRMED when this module proves,
 * against Arc itself, that:
 *
 *   1. the transaction exists,
 *   2. it executed on Arc mainnet (chain id read from the RPC),
 *   3. it succeeded (receipt status === "success"),
 *   4. it contains a USDC `Transfer` event,
 *   5. the event was emitted by the expected Arc mainnet USDC contract,
 *   6. the `to` address matches the payment recipient exactly,
 *   7. the `value` matches the requested amount exactly (base units),
 *   8. the payer address can be read from the event,
 *   9. the transfer occurred at or after the payment was created (using the
 *      Arc block timestamp, with a small clock-skew tolerance),
 *  10. the transaction hash has not already been claimed by another payment.
 *
 * Any failure resolves to `{ ok: false, reason }` and the payment stays
 * PENDING. The code fails closed: a thrown RPC error never becomes CONFIRMED.
 */

export const VERIFICATION_REASONS = [
  "INVALID_TX_HASH",
  "TX_NOT_FOUND",
  "WRONG_CHAIN",
  "TX_REVERTED",
  "NO_USDC_TRANSFER",
  "WRONG_TOKEN",
  "WRONG_RECIPIENT",
  "WRONG_AMOUNT",
  "PAYER_UNKNOWN",
  "TRANSFER_TIME_UNKNOWN",
  "TRANSFER_BEFORE_PAYMENT",
  "REPLAY_DETECTED",
  "RPC_UNAVAILABLE",
  "INVALID_PAYMENT",
] as const;

export type VerificationReason = (typeof VERIFICATION_REASONS)[number];

export type VerificationResult =
  | {
      ok: true;
      payer: `0x${string}`;
      chainId: number;
      blockNumber: bigint;
    }
  | {
      ok: false;
      reason: VerificationReason;
      detail?: string;
    };

export interface EvaluateTransferParams {
  payment: Payment;
  receipt: Pick<TransactionReceipt, "status" | "to" | "logs" | "blockNumber">;
  /** Chain id the RPC actually reported, not the one we hoped for. */
  observedChainId: number;
  expectedChainId?: number;
  expectedUsdcAddress?: string;
  /**
   * Unix seconds of the Arc block that contains the transaction, read from the
   * RPC. Never supplied by a client. `undefined`/`null` fails closed.
   */
  blockTimestamp?: bigint | null;
  /** Clock-skew tolerance in seconds. Defaults to the configured value. */
  toleranceSeconds?: number;
}

/**
 * Pure decision function: given a receipt and the payment, decide whether the
 * transfer is valid. No network access, so it is deterministic and unit
 * testable.
 */
export function evaluateTransferReceipt(
  params: EvaluateTransferParams,
): VerificationResult {
  const {
    payment,
    receipt,
    observedChainId,
    expectedChainId = ARC_MAINNET_CHAIN_ID,
    expectedUsdcAddress = getArcUsdcAddress(),
    blockTimestamp,
    toleranceSeconds = PAYMENT_TRANSFER_TOLERANCE_SECONDS,
  } = params;

  if (observedChainId !== expectedChainId) {
    return { ok: false, reason: "WRONG_CHAIN" };
  }

  if (receipt.status !== "success") {
    return { ok: false, reason: "TX_REVERTED" };
  }

  let expectedAmountBaseUnits: bigint;
  try {
    expectedAmountBaseUnits = parseUsdcAmount(payment.amountUsdc);
  } catch {
    return { ok: false, reason: "INVALID_PAYMENT" };
  }

  const createdAtMs = Date.parse(payment.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return { ok: false, reason: "INVALID_PAYMENT" };
  }
  const createdAtSeconds = Math.floor(createdAtMs / 1000);

  const usdcAddress = expectedUsdcAddress.toLowerCase();

  const allTransfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: receipt.logs as Log[],
  });

  const usdcTransfers = allTransfers.filter(
    (log) => log.address.toLowerCase() === usdcAddress,
  );

  if (usdcTransfers.length === 0) {
    // A transfer event from some other token to the recipient is a wrong-token
    // attempt; anything else is simply not a USDC transfer.
    const foreignToRecipient = allTransfers.some(
      (log) => log.args.to.toLowerCase() === payment.recipient.toLowerCase(),
    );
    return {
      ok: false,
      reason: foreignToRecipient ? "WRONG_TOKEN" : "NO_USDC_TRANSFER",
    };
  }

  const toRecipient = usdcTransfers.filter(
    (log) => log.args.to.toLowerCase() === payment.recipient.toLowerCase(),
  );
  if (toRecipient.length === 0) {
    return { ok: false, reason: "WRONG_RECIPIENT" };
  }

  const exact = toRecipient.find(
    (log) => log.args.value === expectedAmountBaseUnits,
  );
  if (!exact) {
    return {
      ok: false,
      reason: "WRONG_AMOUNT",
      detail: `Expected exactly ${formatUsdcAmount(expectedAmountBaseUnits)} USDC`,
    };
  }

  if (!exact.args.from) {
    return { ok: false, reason: "PAYER_UNKNOWN" };
  }

  // The transfer must not predate the payment request. The timestamp comes from
  // the Arc block, never from the client.
  if (blockTimestamp === undefined || blockTimestamp === null) {
    return { ok: false, reason: "TRANSFER_TIME_UNKNOWN" };
  }
  const earliestAllowedSeconds = BigInt(createdAtSeconds - toleranceSeconds);
  if (blockTimestamp < earliestAllowedSeconds) {
    return {
      ok: false,
      reason: "TRANSFER_BEFORE_PAYMENT",
      detail: `Transfer block time ${blockTimestamp.toString()}s predates payment creation ${createdAtSeconds}s`,
    };
  }

  return {
    ok: true,
    payer: exact.args.from as `0x${string}`,
    chainId: observedChainId,
    blockNumber: receipt.blockNumber,
  };
}

export interface VerifyPaymentOptions {
  /**
   * Returns the id of a payment that already claimed `txHash`, or null. Used to
   * reject replaying one transaction across several payment records.
   */
  findClaimingPaymentId?: (txHash: string) => Promise<string | null>;
}

/**
 * Fetch the transaction from Arc and evaluate it. Fails closed on any RPC
 * error.
 */
export async function verifyPayment(
  payment: Payment,
  txHash: string,
  options: VerifyPaymentOptions = {},
): Promise<VerificationResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, reason: "INVALID_TX_HASH" };
  }

  if (options.findClaimingPaymentId) {
    try {
      const claimingId = await options.findClaimingPaymentId(txHash);
      if (claimingId && claimingId !== payment.id) {
        return { ok: false, reason: "REPLAY_DETECTED" };
      }
    } catch {
      return { ok: false, reason: "RPC_UNAVAILABLE" };
    }
  }

  try {
    const client = getArcPublicClient();
    const [observedChainId, receipt] = await Promise.all([
      client.getChainId(),
      client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
    ]);

    if (!receipt) {
      return { ok: false, reason: "TX_NOT_FOUND" };
    }

    // Authoritative transfer time: the Arc block that includes the transaction.
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });

    return evaluateTransferReceipt({
      payment,
      receipt,
      observedChainId,
      expectedChainId: ARC_MAINNET_CHAIN_ID,
      expectedUsdcAddress: getArcUsdcAddress(),
      blockTimestamp: block?.timestamp ?? null,
    });
  } catch {
    return { ok: false, reason: "RPC_UNAVAILABLE" };
  }
}

/** Re-exported for callers that only need the address type. */
export type { Address };
