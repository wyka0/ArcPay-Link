import { getPaymentRepository } from "@/lib/payments";
import { toPublicPayment } from "@/lib/payments/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/payments/[id] — fetch a single payment. */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/payments/[id]">,
) {
  const { id } = await context.params;
  const payment = await getPaymentRepository().getById(id);
  if (!payment) {
    return Response.json({ error: "Payment not found" }, { status: 404 });
  }
  return Response.json({ payment: toPublicPayment(payment) });
}
