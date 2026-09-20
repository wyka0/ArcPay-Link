import { getPaymentRepository } from "@/lib/payments";
import { toPublicPayment } from "@/lib/payments/types";
import { validateCreatePaymentInput } from "@/lib/payments/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/payments
 *
 * Creates a PENDING payment link. The client can never set the status; new
 * records are always created as PENDING by the repository.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const validation = validateCreatePaymentInput(body);
  if (!validation.ok) {
    return Response.json(
      { error: "Invalid payment request", issues: validation.errors },
      { status: 400 },
    );
  }

  const payment = await getPaymentRepository().create(validation.value);

  return Response.json(
    {
      id: payment.id,
      status: payment.status,
      paymentUrl: `/pay/${payment.id}`,
      payment: toPublicPayment(payment),
    },
    { status: 201 },
  );
}

/** GET /api/payments — recent payments, for local development only. */
export async function GET() {
  const payments = await getPaymentRepository().list();
  return Response.json({ payments: payments.map(toPublicPayment) });
}
