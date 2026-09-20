import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionReceipt } from "viem";

import { evaluateTransferReceipt, verifyPayment } from "@/lib/arc/verify";
import { ARC_MAINNET_CHAIN_ID, ARC_USDC_ADDRESS } from "@/lib/arc/config";
import type { Payment } from "@/lib/payments/types";

import { makeReceipt, makeTransferLog } from "./helpers/logs";

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const PAYER = "0x3333333333333333333333333333333333333333";
const OTHER_TOKEN = "0x9999999999999999999999999999999999999999";
const TX_HASH = `0x${"ab".repeat(32)}`;

/** A block timestamp (unix seconds) comfortably after the default payment. */
const BLOCK_TIME = 1_800_000_000n;

const mocks = vi.hoisted(() => ({
  getChainId: vi.fn(async () => 5042),
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
}));

vi.mock("@/lib/arc/client", () => ({
  getArcPublicClient: () => ({
    getChainId: mocks.getChainId,
    getTransactionReceipt: mocks.getTransactionReceipt,
    getBlock: mocks.getBlock,
  }),
}));

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "payment-1",
    amountUsdc: "5.00",
    amountBaseUnits: "5000000",
    recipient: RECIPIENT,
    description: "Design work",
    status: "PENDING",
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

/** A payment created at the given unix second. */
function paymentCreatedAt(seconds: number): Payment {
  return makePayment({ createdAt: new Date(seconds * 1000).toISOString() });
}

function validReceipt() {
  return makeReceipt({
    to: ARC_USDC_ADDRESS,
    logs: [
      makeTransferLog({
        token: ARC_USDC_ADDRESS,
        from: PAYER,
        to: RECIPIENT,
        value: 5_000_000n,
      }),
    ],
  });
}

function evaluate(params: {
  receipt: ReturnType<typeof makeReceipt>;
  chainId?: number;
  payment?: Payment;
  blockTimestamp?: bigint | null;
}) {
  return evaluateTransferReceipt({
    payment: params.payment ?? makePayment(),
    receipt: params.receipt as unknown as Pick<
      TransactionReceipt,
      "status" | "to" | "logs" | "blockNumber"
    >,
    observedChainId: params.chainId ?? ARC_MAINNET_CHAIN_ID,
    blockTimestamp:
      params.blockTimestamp === undefined ? BLOCK_TIME : params.blockTimestamp,
  });
}

describe("evaluateTransferReceipt", () => {
  it("accepts the exact expected USDC transfer", () => {
    const result = evaluate({
      receipt: makeReceipt({
        to: ARC_USDC_ADDRESS,
        logs: [
          makeTransferLog({
            token: ARC_USDC_ADDRESS,
            from: PAYER,
            to: RECIPIENT,
            value: 5_000_000n,
          }),
        ],
      }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payer).toBe(PAYER);
      expect(result.chainId).toBe(ARC_MAINNET_CHAIN_ID);
    }
  });

  it("rejects a transaction on the wrong chain", () => {
    const result = evaluate({
      chainId: 1,
      receipt: makeReceipt({
        to: ARC_USDC_ADDRESS,
        logs: [
          makeTransferLog({
            token: ARC_USDC_ADDRESS,
            from: PAYER,
            to: RECIPIENT,
            value: 5_000_000n,
          }),
        ],
      }),
    });
    expect(result).toMatchObject({ ok: false, reason: "WRONG_CHAIN" });
  });

  it("rejects a transfer of the wrong token", () => {
    const result = evaluate({
      receipt: makeReceipt({
        to: OTHER_TOKEN,
        logs: [
          makeTransferLog({
            token: OTHER_TOKEN,
            from: PAYER,
            to: RECIPIENT,
            value: 5_000_000n,
          }),
        ],
      }),
    });
    expect(result).toMatchObject({ ok: false, reason: "WRONG_TOKEN" });
  });

  it("rejects the wrong recipient", () => {
    const result = evaluate({
      receipt: makeReceipt({
        to: ARC_USDC_ADDRESS,
        logs: [
          makeTransferLog({
            token: ARC_USDC_ADDRESS,
            from: PAYER,
            to: OTHER,
            value: 5_000_000n,
          }),
        ],
      }),
    });
    expect(result).toMatchObject({ ok: false, reason: "WRONG_RECIPIENT" });
  });

  it("rejects the wrong amount", () => {
    const result = evaluate({
      receipt: makeReceipt({
        to: ARC_USDC_ADDRESS,
        logs: [
          makeTransferLog({
            token: ARC_USDC_ADDRESS,
            from: PAYER,
            to: RECIPIENT,
            value: 4_000_000n,
          }),
        ],
      }),
    });
    expect(result).toMatchObject({ ok: false, reason: "WRONG_AMOUNT" });
  });

  it("rejects a reverted transaction", () => {
    const result = evaluate({
      receipt: makeReceipt({
        status: "reverted",
        to: ARC_USDC_ADDRESS,
        logs: [],
      }),
    });
    expect(result).toMatchObject({ ok: false, reason: "TX_REVERTED" });
  });

  it("rejects a receipt with no transfer event", () => {
    const result = evaluate({
      receipt: makeReceipt({ to: ARC_USDC_ADDRESS, logs: [] }),
    });
    expect(result).toMatchObject({ ok: false, reason: "NO_USDC_TRANSFER" });
  });

  it("rejects an invalid payment record", () => {
    const result = evaluate({
      payment: makePayment({ amountUsdc: "not-a-number" }),
      receipt: makeReceipt({
        to: ARC_USDC_ADDRESS,
        logs: [
          makeTransferLog({
            token: ARC_USDC_ADDRESS,
            from: PAYER,
            to: RECIPIENT,
            value: 5_000_000n,
          }),
        ],
      }),
    });
    expect(result).toMatchObject({ ok: false, reason: "INVALID_PAYMENT" });
  });

  it("rejects a transfer that predates the payment creation", () => {
    const result = evaluate({
      payment: paymentCreatedAt(1_800_000_500),
      receipt: validReceipt(),
      blockTimestamp: BLOCK_TIME, // 1_800_000_000 < created - tolerance
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "TRANSFER_BEFORE_PAYMENT",
    });
  });

  it("accepts a transfer exactly at payment creation", () => {
    const result = evaluate({
      payment: paymentCreatedAt(1_800_000_000),
      receipt: validReceipt(),
      blockTimestamp: 1_800_000_000n,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a transfer slightly before creation within the tolerance", () => {
    const result = evaluate({
      payment: paymentCreatedAt(1_800_000_000),
      receipt: validReceipt(),
      blockTimestamp: 1_799_999_940n, // 60s before creation
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a transfer before creation beyond the tolerance", () => {
    const result = evaluate({
      payment: paymentCreatedAt(1_800_000_000),
      receipt: validReceipt(),
      blockTimestamp: 1_799_999_879n, // 121s before creation
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "TRANSFER_BEFORE_PAYMENT",
    });
  });

  it("fails closed when the block timestamp is unknown", () => {
    const result = evaluate({
      receipt: validReceipt(),
      blockTimestamp: null,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "TRANSFER_TIME_UNKNOWN",
    });
  });
});

describe("verifyPayment", () => {
  beforeEach(() => {
    mocks.getChainId.mockReset();
    mocks.getChainId.mockResolvedValue(ARC_MAINNET_CHAIN_ID);
    mocks.getTransactionReceipt.mockReset();
    mocks.getBlock.mockReset();
    mocks.getBlock.mockResolvedValue({ timestamp: BLOCK_TIME });
  });

  it("rejects a malformed transaction hash without touching the RPC", async () => {
    const result = await verifyPayment(makePayment(), "0x1234");
    expect(result).toMatchObject({ ok: false, reason: "INVALID_TX_HASH" });
    expect(mocks.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("rejects an unknown transaction", async () => {
    mocks.getTransactionReceipt.mockResolvedValue(null);
    const result = await verifyPayment(makePayment(), TX_HASH);
    expect(result).toMatchObject({ ok: false, reason: "TX_NOT_FOUND" });
  });

  it("rejects a transaction already claimed by another payment", async () => {
    const result = await verifyPayment(makePayment(), TX_HASH, {
      findClaimingPaymentId: async () => "another-payment",
    });
    expect(result).toMatchObject({ ok: false, reason: "REPLAY_DETECTED" });
    expect(mocks.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC is unavailable", async () => {
    mocks.getTransactionReceipt.mockRejectedValue(new Error("rpc down"));
    const result = await verifyPayment(makePayment(), TX_HASH);
    expect(result).toMatchObject({ ok: false, reason: "RPC_UNAVAILABLE" });
  });

  it("confirms a valid transaction", async () => {
    mocks.getTransactionReceipt.mockResolvedValue(
      makeReceipt({
        to: ARC_USDC_ADDRESS,
        logs: [
          makeTransferLog({
            token: ARC_USDC_ADDRESS,
            from: PAYER,
            to: RECIPIENT,
            value: 5_000_000n,
          }),
        ],
      }),
    );
    const result = await verifyPayment(makePayment(), TX_HASH);
    expect(result.ok).toBe(true);
  });

  it("rejects an old transaction for a newly created payment", async () => {
    mocks.getTransactionReceipt.mockResolvedValue(validReceipt());
    // Payment created well after the transfer's block.
    const result = await verifyPayment(
      paymentCreatedAt(1_800_000_500),
      TX_HASH,
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "TRANSFER_BEFORE_PAYMENT",
    });
  });

  it("fails closed when the block lookup fails", async () => {
    mocks.getTransactionReceipt.mockResolvedValue(validReceipt());
    mocks.getBlock.mockRejectedValue(new Error("block unavailable"));
    const result = await verifyPayment(makePayment(), TX_HASH);
    expect(result).toMatchObject({ ok: false, reason: "RPC_UNAVAILABLE" });
  });
});
