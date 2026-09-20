import Link from "next/link";

import { LogoLockup } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { WalletSlot } from "./wallet-slot";

const NAV_ITEMS = [
  { label: "Product", href: "/#product" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Security", href: "/#security" },
];

export const Header = () => {
  return (
    <div className="fixed z-50 pt-6 md:pt-10 top-0 left-0 w-full">
      <header className="flex items-center justify-between container">
        <Link href="/" className="inline-flex">
          <LogoLockup className="inline-flex items-center gap-3" />
        </Link>

        <nav className="flex max-lg:hidden absolute left-1/2 -translate-x-1/2 items-center justify-center gap-x-10">
          {NAV_ITEMS.map((item) => (
            <Link
              className="uppercase inline-block font-mono text-sm text-foreground/70 hover:text-foreground duration-150 transition-colors ease-out"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <div className="max-lg:hidden">
            <WalletSlot />
          </div>
          <MobileMenu navItems={NAV_ITEMS} />
        </div>
      </header>
    </div>
  );
};
