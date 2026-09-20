import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

import {
  deriveInitialState,
  failureMessage,
  isFlowActive,
  runPaymentFlow,
  type PaymentFlowDeps,
  type PaymentFlowSnapshot,
} from "@/lib/payments/payment-flow";
import { mapWalletError } from "@/lib/arc/wallet";

const RECIPIENT = "0x1111111111111111111111111111111111111111" as const;
const TX_HASH = `0x${"ab".repeat(32)}` as Hex;

describe("deriveInitialState", () => {
  it("asks to connect when no wallet is connected", () => {
    expect(deriveInitialState({ isConnected: false, chainId: undefined })).toBe(
      "CONNECT_WALLET",
    );
  });

  it("is READY when connected to Arc mainnet", () => {
    expect(deriveInitialState({ isConnected: true, chainId: 5042 })).toBe(
      "READY",
    );
  });

  it("is WRONG_NETWORK when connected to another chain", () => {
    expect(deriveInitialState({ isConnected: true, chainId: 1 })).toBe(
      "WRONG_NETWORK",
    );
  });
});

describe("isFlowActive", () => {
  it("recognises active states", () => {
    for (const state of [
      "SIGNING",
      "SUBMITTED",
      "VERIFYING",
      "CONFIRMED",
      "FAILED",
    ] as const) {
      expect(isFlowActive(state)).toBe(true);
    }
  });

  it("treats preconditions as inactive", () => {
    expect(isFlowActive("READY")).toBe(false);
    expect(isFlowActive("CONNECT_WALLET")).toBe(false);
    expect(isFlowActive("WRONG_NETWORK")).toBe(false);
  });
});

describe("mapWalletError", () => {
  it("maps a user rejection to a transaction rejection when signing", () => {
    const failure = mapWalletError(
      { code: 4001, message: "User rejected the request." },
      "sign",
    );
    expect(failure.code).toBe("USER_REJECTED_TRANSACTION");
  });

  it("maps a user rejection to a connection rejection when connecting", () => {
    const failure = mapWalletError({ code: 4001 }, "connect");
    expect(failure.code).toBe("USER_REJECTED_CONNECTION");
  });

  it("maps a user rejection to a switch rejection when switching", () => {
    const failure = mapWalletError({ code: 4001 }, "switch");
    expect(failure.code).toBe("CHAIN_SWITCH_REJECTED");
  });

  it("maps a missing provider to WALLET_UNAVAILABLE", () => {
    const failure = mapWalletError(
      { name: "ProviderNotFoundError", message: "Provider not found." },
      "connect",
    );
    expect(failure.code).toBe("WALLET_UNAVAILABLE");
  });

  it("maps a chain mismatch to WRONG_NETWORK", () => {
    const failure = mapWalletError(
      { name: "ChainMismatchError", message: "Chain mismatch" },
      "sign",
    );
    expect(failure.code).toBe("WRONG_NETWORK");
  });

  it("maps an insufficient balance revert to INSUFFICIENT_USDC", () => {
    const failure = mapWalletError(
      {
        name: "ContractFunctionExecutionError",
        message: "ERC20: transfer amount exceeds balance",
      },
      "sign",
    );
    expect(failure.code).toBe("INSUFFICIENT_USDC");
  });

  it("maps insufficient funds for gas to INSUFFICIENT_GAS", () => {
    const failure = mapWalletError(
      {
        name: "InsufficientFundsError",
        message: "insufficient funds for gas * price + value",
      },
      "sign",
    );
    expect(failure.code).toBe("INSUFFICIENT_GAS");
  });

  it("maps a missing receipt to RECEIPT_UNAVAILABLE", () => {
    const failure = mapWalletError(
      { name: "TransactionReceiptNotFoundError", message: "receipt not found" },
      "receipt",
    );
    expect(failure.code).toBe("RECEIPT_UNAVAILABLE");
  });

  it("maps an unknown error to UNKNOWN", () => {
    expect(mapWalletError({ message: "weird" }, "sign").code).toBe("UNKNOWN");
  });

  it("never leaks the raw provider message", () => {
    const failure = mapWalletError(
      { message: "super secret internal detail 0xdeadbeef" },
      "sign",
    );
    expect(failure.message).not.toContain("deadbeef");
  });
});

function makeDeps(overrides: Partial<PaymentFlowDeps> = {}): PaymentFlowDeps {
  return {
    sendUsdcTransfer: vi.fn(async () => TX_HASH),
    waitForReceipt: vi.fn(async () => ({ status: "success" as const })),
    verifyOnServer: vi.fn(async () => ({
      ok: true as const,
      payer: RECIPIENT,
    })),
    ...overrides,
  };
}

async function run(
  deps: PaymentFlowDeps,
  recipient = RECIPIENT,
): Promise<{ states: PaymentFlowSnapshot[]; final: PaymentFlowSnapshot }> {
  const states: PaymentFlowSnapshot[] = [];
  const final = await runPaymentFlow(
    { paymentId: "payment-1", recipient, amountBaseUnits: 5_000_000n },
    deps,
    (snapshot) => states.push(snapshot),
  );
  return { states, final };
}

describe("runPaymentFlow", () => {
  it("goes SIGNING -> SUBMITTED -> VERIFYING -> CONFIRMED on success", async () => {
    const deps = makeDeps();
    const { states, final } = await run(deps);

    expect(states.map((snapshot) => snapshot.state)).toEqual([
      "SIGNING",
      "SUBMITTED",
      "VERIFYING",
      "CONFIRMED",
    ]);
    expect(final.state).toBe("CONFIRMED");
    expect(final.txHash).toBe(TX_HASH);
    expect(final.payer).toBe(RECIPIENT);
  });

  it("passes the recipient and bigint amount to the transfer", async () => {
    const deps = makeDeps();
    await run(deps);
    expect(deps.sendUsdcTransfer).toHaveBeenCalledWith({
      recipient: RECIPIENT,
      amountBaseUnits: 5_000_000n,
    });
  });

  it("fails with USER_REJECTED_TRANSACTION and never submits when rejected", async () => {
    const deps = makeDeps({
      sendUsdcTransfer: vi.fn(async () => {
        throw { code: 4001, message: "User rejected the request." };
      }),
    });
    const { states, final } = await run(deps);

    expect(states.map((snapshot) => snapshot.state)).toEqual([
      "SIGNING",
      "FAILED",
    ]);
    expect(final.failure?.code).toBe("USER_REJECTED_TRANSACTION");
    expect(deps.waitForReceipt).not.toHaveBeenCalled();
    expect(deps.verifyOnServer).not.toHaveBeenCalled();
  });

  it("fails without VERIFYING when the receipt cannot be fetched", async () => {
    const deps = makeDeps({
      waitForReceipt: vi.fn(async () => {
        throw {
          name: "TransactionReceiptNotFoundError",
          message: "receipt not found",
        };
      }),
    });
    const { states, final } = await run(deps);

    expect(states.map((snapshot) => snapshot.state)).toEqual([
      "SIGNING",
      "SUBMITTED",
      "FAILED",
    ]);
    expect(final.failure?.code).toBe("RECEIPT_UNAVAILABLE");
    expect(deps.verifyOnServer).not.toHaveBeenCalled();
  });

  it("fails without VERIFYING when the transaction reverted", async () => {
    const deps = makeDeps({
      waitForReceipt: vi.fn(async () => ({ status: "reverted" as const })),
    });
    const { states, final } = await run(deps);

    expect(states.map((snapshot) => snapshot.state)).toEqual([
      "SIGNING",
      "SUBMITTED",
      "FAILED",
    ]);
    expect(final.failure?.code).toBe("TRANSACTION_REVERTED");
    expect(deps.verifyOnServer).not.toHaveBeenCalled();
  });

  it("does not confirm when server verification fails", async () => {
    const deps = makeDeps({
      verifyOnServer: vi.fn(async () => ({
        ok: false as const,
        code: "WRONG_RECIPIENT" as const,
        message: failureMessage("WRONG_RECIPIENT"),
      })),
    });
    const { states, final } = await run(deps);

    expect(states.map((snapshot) => snapshot.state)).toEqual([
      "SIGNING",
      "SUBMITTED",
      "VERIFYING",
      "FAILED",
    ]);
    expect(final.state).toBe("FAILED");
    expect(final.failure?.code).toBe("WRONG_RECIPIENT");
  });

  it("does not confirm when the transaction was already claimed", async () => {
    const deps = makeDeps({
      verifyOnServer: vi.fn(async () => ({
        ok: false as const,
        code: "REPLAY_DETECTED" as const,
        message: failureMessage("REPLAY_DETECTED"),
      })),
    });
    const { final } = await run(deps);
    expect(final.state).toBe("FAILED");
    expect(final.failure?.code).toBe("REPLAY_DETECTED");
  });

  it("fails closed when the verify request itself throws", async () => {
    const deps = makeDeps({
      verifyOnServer: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const { final } = await run(deps);
    expect(final.state).toBe("FAILED");
    expect(final.failure?.code).toBe("SERVER_ERROR");
  });

  it("rejects a wrong amount returned by the verifier", async () => {
    const deps = makeDeps({
      verifyOnServer: vi.fn(async () => ({
        ok: false as const,
        code: "WRONG_AMOUNT" as const,
        message: failureMessage("WRONG_AMOUNT"),
      })),
    });
    const { final } = await run(deps);
    expect(final.state).toBe("FAILED");
    expect(final.failure?.code).toBe("WRONG_AMOUNT");
  });

  it("rejects a wrong token returned by the verifier", async () => {
    const deps = makeDeps({
      verifyOnServer: vi.fn(async () => ({
        ok: false as const,
        code: "WRONG_TOKEN" as const,
        message: failureMessage("WRONG_TOKEN"),
      })),
    });
    const { final } = await run(deps);
    expect(final.state).toBe("FAILED");
    expect(final.failure?.code).toBe("WRONG_TOKEN");
  });

  it("rejects a transfer older than the payment request", async () => {
    const deps = makeDeps({
      verifyOnServer: vi.fn(async () => ({
        ok: false as const,
        code: "TRANSFER_BEFORE_PAYMENT" as const,
        message: failureMessage("TRANSFER_BEFORE_PAYMENT"),
      })),
    });
    const { final } = await run(deps);
    expect(final.state).toBe("FAILED");
    expect(final.failure?.code).toBe("TRANSFER_BEFORE_PAYMENT");
  });
});
