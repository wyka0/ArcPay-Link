import type { Address, Hex } from "viem";

import type { VerificationReason } from "@/lib/arc/verify";
import { mapWalletError, type WalletFailureCode } from "@/lib/arc/wallet";

import { ARC_MAINNET_CHAIN_ID } from "@/lib/arc/config";

/**
 * Explicit payment-flow states. `CONFIRMED` is only ever reachable after the
 * server has independently verified the transaction; frontend state alone can
 * never produce it.
 */
export type PaymentFlowState =
  | "CONNECT_WALLET"
  | "READY"
  | "WRONG_NETWORK"
  | "SIGNING"
  | "SUBMITTED"
  | "VERIFYING"
  | "CONFIRMED"
  | "FAILED";

export type PaymentFailureCode =
  | WalletFailureCode
  | VerificationReason
  | "VERIFICATION_FAILED"
  | "SERVER_ERROR";

export interface PaymentFlowSnapshot {
  state: PaymentFlowState;
  txHash?: Hex;
  payer?: string;
  failure?: { code: PaymentFailureCode; message: string };
}

/** States that mean a payment attempt is under way or finished. */
const ACTIVE_STATES: ReadonlySet<PaymentFlowState> = new Set([
  "SIGNING",
  "SUBMITTED",
  "VERIFYING",
  "CONFIRMED",
  "FAILED",
]);

/** True when the flow has moved past the wallet/network preconditions. */
export function isFlowActive(state: PaymentFlowState): boolean {
  return ACTIVE_STATES.has(state);
}

export interface DeriveInitialStateParams {
  isConnected: boolean;
  chainId: number | null | undefined;
  expectedChainId?: number;
}

/**
 * Decide the precondition state from the wallet connection. This is pure so it
 * can be tested without a provider.
 */
export function deriveInitialState(
  params: DeriveInitialStateParams,
): PaymentFlowState {
  if (!params.isConnected) {
    return "CONNECT_WALLET";
  }
  const expected = params.expectedChainId ?? ARC_MAINNET_CHAIN_ID;
  if (params.chainId !== expected) {
    return "WRONG_NETWORK";
  }
  return "READY";
}

const VERIFICATION_MESSAGES: Record<VerificationReason, string> = {
  INVALID_TX_HASH: "The transaction hash is invalid.",
  TX_NOT_FOUND: "The transaction was not found on Arc.",
  WRONG_CHAIN: "The transaction is not on Arc mainnet.",
  TX_REVERTED: "The transaction reverted on Arc.",
  NO_USDC_TRANSFER: "No USDC transfer was found in the transaction.",
  WRONG_TOKEN: "The transaction did not transfer the expected USDC token.",
  WRONG_RECIPIENT: "The transaction did not pay the expected recipient.",
  WRONG_AMOUNT: "The transaction amount does not match the payment request.",
  PAYER_UNKNOWN: "The payer could not be identified from the transaction.",
  TRANSFER_TIME_UNKNOWN:
    "The transfer time could not be established from Arc. Try again.",
  TRANSFER_BEFORE_PAYMENT:
    "The transaction is older than this payment request and cannot be used.",
  REPLAY_DETECTED: "This transaction was already used for another payment.",
  RPC_UNAVAILABLE: "Arc RPC was unavailable during verification.",
  INVALID_PAYMENT: "The payment record is invalid.",
};

/** User-safe message for any failure code raised by the flow. */
export function failureMessage(code: PaymentFailureCode): string {
  if (code in VERIFICATION_MESSAGES) {
    return VERIFICATION_MESSAGES[code as VerificationReason];
  }
  if (code === "VERIFICATION_FAILED") {
    return "The payment could not be verified on Arc.";
  }
  if (code === "SERVER_ERROR") {
    return "The verification service was unavailable. Try again.";
  }
  return "Something went wrong. Please try again.";
}

export type ServerVerificationOutcome =
  | { ok: true; payer: string }
  | { ok: false; code: PaymentFailureCode; message: string };

export interface PaymentFlowDeps {
  /** Sign and submit USDC.transfer on Arc. Resolves to the transaction hash. */
  sendUsdcTransfer: (args: {
    recipient: Address;
    amountBaseUnits: bigint;
  }) => Promise<Hex>;
  /** Wait for the Arc receipt. */
  waitForReceipt: (txHash: Hex) => Promise<{ status: "success" | "reverted" }>;
  /** Ask the server to verify the transaction against Arc. */
  verifyOnServer: (args: {
    paymentId: string;
    txHash: Hex;
  }) => Promise<ServerVerificationOutcome>;
}

export interface RunPaymentFlowParams {
  paymentId: string;
  recipient: Address;
  amountBaseUnits: bigint;
}

/**
 * Drive one payment attempt through the explicit states, calling `onUpdate`
 * with each snapshot. All side effects are injected, so this is deterministic
 * and testable without a wallet or a chain.
 *
 * The function never returns `CONFIRMED` unless `verifyOnServer` explicitly
 * reports success.
 */
export async function runPaymentFlow(
  params: RunPaymentFlowParams,
  deps: PaymentFlowDeps,
  onUpdate: (snapshot: PaymentFlowSnapshot) => void,
): Promise<PaymentFlowSnapshot> {
  const update = (next: PaymentFlowSnapshot): PaymentFlowSnapshot => {
    onUpdate(next);
    return next;
  };

  update({ state: "SIGNING" });

  let txHash: Hex;
  try {
    txHash = await deps.sendUsdcTransfer({
      recipient: params.recipient,
      amountBaseUnits: params.amountBaseUnits,
    });
  } catch (error) {
    const walletFailure = mapWalletError(error, "sign");
    return update({
      state: "FAILED",
      failure: { code: walletFailure.code, message: walletFailure.message },
    });
  }

  update({ state: "SUBMITTED", txHash });

  let receipt: { status: "success" | "reverted" };
  try {
    receipt = await deps.waitForReceipt(txHash);
  } catch (error) {
    const walletFailure = mapWalletError(error, "receipt");
    return update({
      state: "FAILED",
      txHash,
      failure: { code: walletFailure.code, message: walletFailure.message },
    });
  }

  if (receipt.status !== "success") {
    return update({
      state: "FAILED",
      txHash,
      failure: {
        code: "TRANSACTION_REVERTED",
        message: "The transaction reverted on Arc and was not completed.",
      },
    });
  }

  update({ state: "VERIFYING", txHash });

  let outcome: ServerVerificationOutcome;
  try {
    outcome = await deps.verifyOnServer({
      paymentId: params.paymentId,
      txHash,
    });
  } catch {
    return update({
      state: "FAILED",
      txHash,
      failure: {
        code: "SERVER_ERROR",
        message: "The verification service was unavailable. Try again.",
      },
    });
  }

  if (!outcome.ok) {
    return update({
      state: "FAILED",
      txHash,
      failure: { code: outcome.code, message: outcome.message },
    });
  }

  return update({
    state: "CONFIRMED",
    txHash,
    payer: outcome.payer,
  });
}
