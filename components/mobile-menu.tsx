"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { WalletSlot } from "./wallet-slot";

interface NavItem {
  label: string;
  href: string;
}

interface MobileMenuProps {
  className?: string;
  navItems: NavItem[];
}

/**
 * Adapted from the Skal template (`components/mobile-menu.tsx`). Radix provides
 * the focus trap, Escape handling and focus return. ArcPay keeps the wallet
 * control inside the panel.
 */
export const MobileMenu = ({ className, navItems }: MobileMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog.Root modal={false} open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Trigger asChild>
        <button
          className={cn(
            "group lg:hidden p-2 text-foreground transition-colors",
            className,
          )}
          aria-label={isOpen ? "Close menu" : "Open menu"}
        >
          <Menu className="group-[[data-state=open]]:hidden" size={24} />
          <X className="hidden group-[[data-state=open]]:block" size={24} />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed z-30 inset-0 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />

        <Dialog.Content className="fixed top-0 left-0 w-full z-40 py-28 md:py-40 outline-none">
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
          <Dialog.Description className="sr-only">
            Site navigation and wallet connection.
          </Dialog.Description>

          <nav className="flex flex-col space-y-6 container mx-auto">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className="text-xl font-mono uppercase text-foreground/70 transition-colors ease-out duration-150 hover:text-foreground py-2"
              >
                {item.label}
              </Link>
            ))}

            <div className="mt-6">
              <WalletSlot />
            </div>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
