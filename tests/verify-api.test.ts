import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verifyPayment: vi.fn() }));

vi.mock("@/lib/arc/verify", () => ({
  verifyPayment: mocks.verifyPayment,
}));

import { POST as createPayment } from "@/app/api/payments/route";
import { POST as verifyPaymentRoute } from "@/app/api/payments/[id]/verify/route";
import { getPaymentRepository } from "@/lib/payments";

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const PAYER = "0x3333333333333333333333333333333333333333";
const TX_HASH = `0x${"ab".repeat(32)}`;

/**
 * The in-memory repository is a process-wide singleton, so confirming tests
 * must not share a transaction hash. Each call returns a fresh, valid 32-byte
 * hash.
 */
let hashCounter = 0;
function uniqueHash(): string {
  hashCounter += 1;
  return `0x${hashCounter.toString(16).padStart(64, "0")}`;
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) } as Parameters<
    typeof verifyPaymentRoute
  >[1];
}

async function createTestPayment(): Promise<string> {
  const response = await createPayment(
    jsonRequest("http://localhost/api/payments", {
      amountUsdc: "5.00",
      description: "Design work",
      recipient: RECIPIENT,
    }),
  );
  const body = (await response.json()) as { id: string };
  return body.id;
}

describe("POST /api/payments/[id]/verify", () => {
  beforeEach(() => {
    mocks.verifyPayment.mockReset();
  });

  it("returns 400 when the transaction hash is missing", async () => {
    const id = await createTestPayment();
    const response = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {}),
      context(id),
    );
    expect(response.status).toBe(400);
    expect(mocks.verifyPayment).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed transaction hash", async () => {
    const id = await createTestPayment();
    const response = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: "0x1234",
      }),
      context(id),
    );
    expect(response.status).toBe(400);
    expect(mocks.verifyPayment).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown payment", async () => {
    const response = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: TX_HASH,
      }),
      context("does-not-exist"),
    );
    expect(response.status).toBe(404);
  });

  it("returns 422 and leaves the payment PENDING when verification fails", async () => {
    const id = await createTestPayment();
    mocks.verifyPayment.mockResolvedValue({
      ok: false,
      reason: "WRONG_RECIPIENT",
    });

    const response = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: TX_HASH,
      }),
      context(id),
    );

    expect(response.status).toBe(422);
    expect((await getPaymentRepository().getById(id))?.status).toBe("PENDING");
  });

  it("returns 503 when the RPC is unavailable", async () => {
    const id = await createTestPayment();
    mocks.verifyPayment.mockResolvedValue({
      ok: false,
      reason: "RPC_UNAVAILABLE",
    });

    const response = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: TX_HASH,
      }),
      context(id),
    );

    expect(response.status).toBe(503);
    expect((await getPaymentRepository().getById(id))?.status).toBe("PENDING");
  });

  it("returns 409 when the verifier reports a replay", async () => {
    const id = await createTestPayment();
    mocks.verifyPayment.mockResolvedValue({
      ok: false,
      reason: "REPLAY_DETECTED",
    });

    const response = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: TX_HASH,
      }),
      context(id),
    );

    expect(response.status).toBe(409);
    expect((await getPaymentRepository().getById(id))?.status).toBe("PENDING");
  });

  it("confirms the payment only when the verifier succeeds", async () => {
    const id = await createTestPayment();
    const hash = uniqueHash();
    mocks.verifyPayment.mockResolvedValue({
      ok: true,
      payer: PAYER,
      chainId: 5042,
      blockNumber: 1n,
    });

    const response = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: hash,
      }),
      context(id),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      payment: {
        status: string;
        txHash: string;
        payer: string;
        confirmedAt?: string;
      };
    };
    expect(body.payment.status).toBe("CONFIRMED");
    expect(body.payment.txHash).toBe(hash);
    expect(body.payment.payer).toBe(PAYER);
    expect(body.payment.confirmedAt).toBeTruthy();

    const stored = await getPaymentRepository().getById(id);
    expect(stored?.status).toBe("CONFIRMED");
    expect(stored?.txHash).toBe(hash);
  });

  it("ignores a client-provided status field", async () => {
    const id = await createTestPayment();
    mocks.verifyPayment.mockResolvedValue({
      ok: false,
      reason: "WRONG_AMOUNT",
    });

    const response = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: TX_HASH,
        status: "CONFIRMED",
      }),
      context(id),
    );

    expect(response.status).toBe(422);
    expect((await getPaymentRepository().getById(id))?.status).toBe("PENDING");
  });

  it("rejects reusing one transaction for a second payment", async () => {
    const hash = uniqueHash();
    const first = await createTestPayment();
    mocks.verifyPayment.mockResolvedValue({
      ok: true,
      payer: PAYER,
      chainId: 5042,
      blockNumber: 1n,
    });

    const firstResponse = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: hash,
      }),
      context(first),
    );
    expect(firstResponse.status).toBe(200);

    const second = await createTestPayment();
    const secondResponse = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: hash,
      }),
      context(second),
    );

    expect(secondResponse.status).toBe(409);
    expect((await getPaymentRepository().getById(second))?.status).toBe(
      "PENDING",
    );
  });

  it("is idempotent for an already confirmed payment and same hash", async () => {
    const id = await createTestPayment();
    const hash = uniqueHash();
    mocks.verifyPayment.mockResolvedValue({
      ok: true,
      payer: PAYER,
      chainId: 5042,
      blockNumber: 1n,
    });

    await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: hash,
      }),
      context(id),
    );

    mocks.verifyPayment.mockClear();

    const response = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: hash,
      }),
      context(id),
    );

    expect(response.status).toBe(200);
    expect(mocks.verifyPayment).not.toHaveBeenCalled();
  });

  it("passes the replay check callback to the verifier", async () => {
    const id = await createTestPayment();
    mocks.verifyPayment.mockResolvedValue({
      ok: false,
      reason: "TX_NOT_FOUND",
    });

    await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: TX_HASH,
      }),
      context(id),
    );

    expect(mocks.verifyPayment).toHaveBeenCalledTimes(1);
    const options = mocks.verifyPayment.mock.calls[0][2] as {
      findClaimingPaymentId?: unknown;
    };
    expect(typeof options.findClaimingPaymentId).toBe("function");
  });

  it("returns 409 for a different hash when the payment is already confirmed", async () => {
    const id = await createTestPayment();
    const firstHash = uniqueHash();
    const secondHash = uniqueHash();
    mocks.verifyPayment.mockResolvedValue({
      ok: true,
      payer: PAYER,
      chainId: 5042,
      blockNumber: 1n,
    });

    await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: firstHash,
      }),
      context(id),
    );

    const response = await verifyPaymentRoute(
      jsonRequest("http://localhost/api/payments/x/verify", {
        txHash: secondHash,
      }),
      context(id),
    );

    expect(response.status).toBe(409);
  });
});
