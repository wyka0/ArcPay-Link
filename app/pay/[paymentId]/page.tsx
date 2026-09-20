import { notFound } from "next/navigation";

import { PaymentFlow } from "@/components/PaymentFlow";
import { getPaymentRepository } from "@/lib/payments";
import { toPublicPayment } from "@/lib/payments/types";

export const dynamic = "force-dynamic";

export default async function PayPage(props: PageProps<"/pay/[paymentId]">) {
  const { paymentId } = await props.params;

  const record = await getPaymentRepository().getById(paymentId);
  if (!record) {
    notFound();
  }

  const payment = toPublicPayment(record);

  return (
    <main id="main" className="relative z-10 min-h-svh bg-black">
      <div className="container pt-36 pb-24 md:pt-44 md:pb-32">
        <div className="mx-auto max-w-[600px]">
          <PaymentFlow payment={payment} />
        </div>
      </div>
    </main>
  );
}
