export function ProductPreview() {
  return (
    <figure className="max-w-[520px]" aria-labelledby="preview-caption">
      <div className="relative border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-foreground/70">
            ArcPay Link
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/50">
            Sample
          </span>
        </div>

        <div className="flex flex-col gap-6 px-6 py-8">
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/50">
            Payment request
          </span>

          <p className="font-sentient text-5xl leading-none">
            5.00 <span className="font-mono text-sm uppercase">USDC</span>
          </p>

          <p className="font-mono text-sm text-foreground/60">
            Design consultation
          </p>

          <dl className="flex flex-col gap-4 font-mono text-xs">
            <div className="flex flex-col gap-1">
              <dt className="uppercase tracking-[0.18em] text-foreground/50">
                Recipient
              </dt>
              <dd className="text-foreground/80">0x9a3f…7c21</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="uppercase tracking-[0.18em] text-foreground/50">
                Network
              </dt>
              <dd className="text-foreground/80">Arc mainnet</dd>
            </div>
          </dl>

          <div
            aria-hidden="true"
            className="border border-primary px-4 py-3 text-center font-mono text-xs uppercase tracking-[0.18em] text-primary"
          >
            Pay 5.00 USDC
          </div>
        </div>
      </div>

      <figcaption
        id="preview-caption"
        className="mt-4 font-mono text-[11px] text-foreground/60"
      >
        Product preview — sample layout only. No live payment data.
      </figcaption>
    </figure>
  );
}
