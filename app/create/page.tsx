import { CreatePaymentForm } from "@/components/CreatePaymentForm";

export const metadata = {
  title: "Create a payment link — ArcPay Link",
};

export default function CreatePage() {
  return (
    <main id="main" className="relative z-10 min-h-svh bg-black">
      <div className="container pt-36 pb-24 md:pt-44 md:pb-32">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/50">
          New payment link
        </p>
        <h1 className="mt-6 max-w-[18ch] font-sentient text-4xl md:text-6xl leading-[1.02]">
          Create a payment link
        </h1>
        <p className="mt-6 max-w-[52ch] font-mono text-sm text-foreground/60">
          Set an amount in USDC and a recipient. Share the link to get paid on
          Arc mainnet.
        </p>

        <div className="mt-14 max-w-[560px]">
          <CreatePaymentForm />
        </div>
      </div>
    </main>
  );
}
