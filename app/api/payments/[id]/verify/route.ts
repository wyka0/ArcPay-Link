import { verifyPayment } from "@/lib/arc/verify";
import {
  getPaymentRepository,
  TransactionAlreadyClaimedError,
} from "@/lib/payments";
import { toPublicPayment } from "@/lib/payments/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments/[id]/verify
 *
 * The only path that can move a payment to CONFIRMED. It independently checks
 * the transaction against Arc mainnet via the verifier, then atomically claims
 * the transaction so it cannot satisfy a second payment.
 *
 * Sequence is always: verify on-chain -> atomic claim -> CONFIRMED.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/payments/[id]/verify">,
) {
  const { id } = await context.params;
  const repository = getPaymentRepository();

  const payment = await repository.getById(id);
  if (!payment) {
    return Response.json({ error: "Payment not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const txHash =
    typeof (body as { txHash?: unknown })?.txHash === "string"
      ? (body as { txHash: string }).txHash
      : "";

  if (!txHash) {
    return Response.json({ error: "txHash is required" }, { status: 400 });
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return Response.json(
      { error: "txHash must be a 32-byte hex string" },
      { status: 400 },
    );
  }

  // Idempotent: an already confirmed payment with the same hash stays confirmed.
  if (payment.status === "CONFIRMED") {
    if (payment.txHash?.toLowerCase() === txHash.toLowerCase()) {
      return Response.json({ payment: toPublicPayment(payment) });
    }
    return Response.json(
      { error: "Payment already claimed by another transaction" },
      { status: 409 },
    );
  }

  const result = await verifyPayment(payment, txHash, {
    findClaimingPaymentId: (hash) => repository.findClaimingPaymentId(hash),
  });

  if (!result.ok) {
    const status =
      result.reason === "RPC_UNAVAILABLE"
        ? 503
        : result.reason === "REPLAY_DETECTED"
          ? 409
          : 422;
    return Response.json(
      { error: "Payment could not be verified", reason: result.reason },
      { status },
    );
  }

  try {
    const confirmed = await repository.claim(id, {
      txHash,
      payer: result.payer,
    });
    return Response.json({ payment: toPublicPayment(confirmed) });
  } catch (error) {
    if (error instanceof TransactionAlreadyClaimedError) {
      return Response.json(
        { error: "Transaction already claimed by another payment" },
        { status: 409 },
      );
    }
    return Response.json(
      { error: "Payment could not be confirmed" },
      { status: 500 },
    );
  }
}
