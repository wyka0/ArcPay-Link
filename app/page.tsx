import { Hero } from "@/components/hero";
import { ProductPreview } from "@/components/ProductPreview";

const STEPS = [
  { number: "01", title: "Create", body: "Create a payment\nin seconds." },
  { number: "02", title: "Share", body: "Send your payment\nlink anywhere." },
  { number: "03", title: "Settle", body: "Receive USDC\non Arc." },
];

const CLAIMS = [
  "Arc Mainnet",
  "USDC Payments",
  "On-chain Verification",
  "Replay Protection",
  "Non-custodial",
];

export default function Home() {
  return (
    <main id="main">
      <Hero />

      <section
        id="product"
        className="relative z-10 bg-black border-t border-border"
      >
        <div className="container py-24 md:py-36">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/50">
            Product
          </p>
          <h2 className="mt-6 max-w-[18ch] font-sentient text-4xl md:text-6xl leading-[1.02]">
            USDC payment links,
            <i className="font-light"> on Arc.</i>
          </h2>
          <p className="mt-8 max-w-[52ch] font-mono text-sm md:text-base text-foreground/60">
            A payer opens the link, connects a wallet, and sends USDC straight
            to the recipient on Arc mainnet. The payment is only marked
            confirmed after it is independently verified on-chain.
          </p>

          <div className="mt-16 md:mt-20">
            <ProductPreview />
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="relative z-10 bg-black border-t border-border"
      >
        <div className="container py-24 md:py-36">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/50">
            How it works
          </p>

          <ol className="mt-16 grid gap-16 md:grid-cols-3 md:gap-10">
            {STEPS.map((step) => (
              <li key={step.number} className="flex flex-col gap-6">
                <span className="font-mono text-sm tracking-[0.22em] text-primary">
                  {step.number}
                </span>
                <h3 className="font-sentient text-3xl md:text-4xl">
                  {step.title}
                </h3>
                <p className="whitespace-pre-line font-mono text-sm text-foreground/60">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="security"
        className="relative z-10 bg-black border-t border-border"
      >
        <div className="container py-24 md:py-36">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/50">
            Security
          </p>
          <h2 className="mt-6 max-w-[20ch] font-sentient text-4xl md:text-6xl leading-[1.02]">
            Built for real payments.
          </h2>
          <p className="mt-8 max-w-[52ch] font-mono text-sm md:text-base text-foreground/60">
            ArcPay Link is non-custodial. Your wallet signs the transfer, and
            the server verifies the result against Arc before any payment is
            marked confirmed.
          </p>

          <ul className="mt-16 flex flex-wrap gap-3">
            {CLAIMS.map((claim) => (
              <li
                key={claim}
                className="border border-border px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-foreground/70"
              >
                {claim}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="relative z-10 bg-black border-t border-border">
        <div className="container flex flex-col items-center gap-10 py-28 text-center md:py-40">
          <h2 className="max-w-[22ch] font-sentient text-4xl md:text-6xl leading-[1.02]">
            Start accepting
            <i className="font-light"> USDC on Arc.</i>
          </h2>
          <a
            href="/create"
            className="inline-flex h-16 items-center justify-center border border-primary bg-background px-6 font-mono text-base uppercase text-foreground transition-shadow duration-300 hover:shadow-[inset_0_0_54px_0px_#EBB800] shadow-[inset_0_0_54px_0px_#EBB800]/70"
          >
            [ CREATE PAYMENT ]
          </a>
        </div>
      </section>
    </main>
  );
}
