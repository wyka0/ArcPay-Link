"use client";

import dynamic from "next/dynamic";

/**
 * Defers the wallet bundle (wagmi + viem + react-query, ~150 KB) off the
 * critical path. The nav renders immediately with a same-size placeholder so
 * nothing shifts when the real control arrives.
 */
const WalletButton = dynamic(
  () => import("./WalletButton").then((mod) => mod.WalletButton),
  {
    ssr: false,
    loading: () => (
      <span
        aria-hidden="true"
        className="inline-block h-14 w-[168px] border border-border/60"
      />
    ),
  },
);

export function WalletSlot() {
  return <WalletButton />;
}
