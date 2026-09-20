import { ARC_MAINNET_CHAIN_ID } from "./config";

/**
 * Wallet-facing helpers that are framework-agnostic and unit testable.
 *
 * This module deliberately does not import wagmi or viem actions, so it can be
 * used from pure logic and tests without a provider. The wagmi config lives in
 * `./wagmi`.
 */

/** True only when the connected chain is Arc mainnet. */
export function isArcChain(chainId: number | null | undefined): boolean {
  return chainId === ARC_MAINNET_CHAIN_ID;
}

export const WALLET_FAILURE_CODES = [
  "WALLET_UNAVAILABLE",
  "USER_REJECTED_CONNECTION",
  "USER_REJECTED_TRANSACTION",
  "WALLET_DISCONNECTED",
  "WRONG_NETWORK",
  "CHAIN_SWITCH_REJECTED",
  "UNSUPPORTED_CHAIN",
  "INSUFFICIENT_USDC",
  "INSUFFICIENT_GAS",
  "TRANSACTION_REVERTED",
  "RECEIPT_UNAVAILABLE",
  "NETWORK_ERROR",
  "UNKNOWN",
] as const;

export type WalletFailureCode = (typeof WALLET_FAILURE_CODES)[number];

export interface WalletFailure {
  code: WalletFailureCode;
  message: string;
}

export const WALLET_FAILURE_MESSAGES: Record<WalletFailureCode, string> = {
  WALLET_UNAVAILABLE:
    "No EVM wallet was detected. Install a browser wallet such as MetaMask and reload.",
  USER_REJECTED_CONNECTION: "Connection request was rejected in your wallet.",
  USER_REJECTED_TRANSACTION: "Transaction was rejected in your wallet.",
  WALLET_DISCONNECTED: "Your wallet disconnected. Reconnect and try again.",
  WRONG_NETWORK:
    "Your wallet is not on Arc mainnet. Switch to Arc to continue.",
  CHAIN_SWITCH_REJECTED:
    "The network switch to Arc was rejected in your wallet.",
  UNSUPPORTED_CHAIN:
    "Your wallet does not support switching to Arc automatically. Add Arc manually and retry.",
  INSUFFICIENT_USDC: "Insufficient USDC balance to complete this payment.",
  INSUFFICIENT_GAS: "Insufficient USDC to cover the Arc network gas fee.",
  TRANSACTION_REVERTED:
    "The transaction reverted on Arc and was not completed.",
  RECEIPT_UNAVAILABLE:
    "Could not confirm the transaction receipt on Arc. Try again.",
  NETWORK_ERROR: "Network or RPC problem while talking to your wallet or Arc.",
  UNKNOWN: "Something went wrong. Please try again.",
};

interface CollectedError {
  names: string[];
  codes: (string | number)[];
  messages: string[];
}

/** Walk an error and its cause chain collecting names, codes and messages. */
function collectError(error: unknown, depth = 0): CollectedError {
  const collected: CollectedError = { names: [], codes: [], messages: [] };
  if (depth > 5 || error === null || error === undefined) {
    return collected;
  }

  if (typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.name === "string")
      collected.names.push(candidate.name);
    if (
      typeof candidate.code === "string" ||
      typeof candidate.code === "number"
    ) {
      collected.codes.push(candidate.code);
    }
    for (const key of ["shortMessage", "message", "details"]) {
      const value = candidate[key];
      if (typeof value === "string") collected.messages.push(value);
    }
    if ("cause" in candidate) {
      const nested = collectError(candidate.cause, depth + 1);
      collected.names.push(...nested.names);
      collected.codes.push(...nested.codes);
      collected.messages.push(...nested.messages);
    }
  } else if (typeof error === "string") {
    collected.messages.push(error);
  }

  return collected;
}

function hasName(collected: CollectedError, ...fragments: string[]): boolean {
  return collected.names.some((name) =>
    fragments.some((fragment) => name.toLowerCase().includes(fragment)),
  );
}

function hasMessage(
  collected: CollectedError,
  ...fragments: string[]
): boolean {
  return collected.messages.some((message) =>
    fragments.some((fragment) => message.toLowerCase().includes(fragment)),
  );
}

/**
 * Map a wallet/RPC/contract error to a stable, user-safe failure code and
 * message. Never surfaces raw provider messages or stack traces.
 */
export function mapWalletError(
  error: unknown,
  phase: "connect" | "sign" | "receipt" | "switch",
): WalletFailure {
  const collected = collectError(error);

  const userRejected =
    collected.codes.includes(4001) ||
    hasName(collected, "UserRejectedRequest") ||
    hasMessage(
      collected,
      "user rejected",
      "user denied",
      "rejected the request",
      "user cancelled",
    );

  if (userRejected) {
    if (phase === "connect") return failure("USER_REJECTED_CONNECTION");
    if (phase === "switch") return failure("CHAIN_SWITCH_REJECTED");
    return failure("USER_REJECTED_TRANSACTION");
  }

  if (
    hasName(collected, "ProviderNotFound") ||
    hasMessage(
      collected,
      "provider not found",
      "no ethereum provider",
      "wallet not installed",
      "no wallet detected",
      "window.ethereum is undefined",
    )
  ) {
    return failure("WALLET_UNAVAILABLE");
  }

  if (
    hasName(collected, "ConnectorNotConnected", "ConnectorAlreadyConnected") ||
    hasMessage(collected, "not connected", "disconnected")
  ) {
    return failure("WALLET_DISCONNECTED");
  }

  if (
    hasName(
      collected,
      "ChainMismatch",
      "ChainNotConfigured",
      "ChainDisconnected",
      "SwitchChain",
    ) ||
    hasMessage(
      collected,
      "chain mismatch",
      "wrong network",
      "unsupported chain",
    )
  ) {
    if (phase === "switch") {
      return failure(
        hasName(collected, "ChainDisconnected") ||
          hasMessage(collected, "unsupported chain")
          ? "UNSUPPORTED_CHAIN"
          : "CHAIN_SWITCH_REJECTED",
      );
    }
    return failure("WRONG_NETWORK");
  }

  if (
    hasName(
      collected,
      "TransactionReceiptNotFound",
      "WaitForTransactionReceiptTimeout",
    ) ||
    hasMessage(collected, "receipt not found", "timed out while waiting")
  ) {
    return failure("RECEIPT_UNAVAILABLE");
  }

  if (
    hasMessage(
      collected,
      "exceeds balance",
      "exceeds allowance",
      "transfer amount",
    )
  ) {
    return failure("INSUFFICIENT_USDC");
  }

  if (
    hasName(collected, "InsufficientFunds") ||
    hasMessage(collected, "insufficient funds")
  ) {
    return failure(
      hasMessage(collected, "gas") ? "INSUFFICIENT_GAS" : "INSUFFICIENT_USDC",
    );
  }

  if (
    hasName(
      collected,
      "ContractFunctionExecution",
      "ContractFunctionReverted",
      "ContractFunctionZeroData",
      "CallExecution",
      "TransactionExecution",
    ) ||
    hasMessage(collected, "reverted", "execution reverted")
  ) {
    return failure("TRANSACTION_REVERTED");
  }

  if (
    hasName(collected, "HttpRequest", "Timeout", "Fetch") ||
    hasMessage(collected, "failed to fetch", "network", "timeout")
  ) {
    return failure("NETWORK_ERROR");
  }

  return failure("UNKNOWN");
}

function failure(code: WalletFailureCode): WalletFailure {
  return { code, message: WALLET_FAILURE_MESSAGES[code] };
}
