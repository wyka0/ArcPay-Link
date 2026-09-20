import Link from "next/link";

const NAV_ITEMS = [
  { label: "Product", href: "/#product" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Security", href: "/#security" },
];

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-border bg-black">
      <div className="container py-14 md:py-20">
        <div className="flex flex-col gap-12 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-3">
            <span className="font-sentient text-2xl">ArcPay Link</span>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-foreground/50">
              USDC payments on Arc
            </p>
          </div>

          <nav
            className="flex flex-col gap-3 font-mono text-xs uppercase tracking-[0.18em]"
            aria-label="Footer"
          >
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-foreground/60 transition-colors duration-150 hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex flex-col gap-3 font-mono text-xs uppercase tracking-[0.18em] text-foreground/50">
            <span className="inline-flex items-center gap-2 text-foreground/70">
              <span className="inline-block size-2 rounded-full bg-primary" />
              Arc Mainnet
            </span>
            <span>© 2026 ArcPay Link</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
