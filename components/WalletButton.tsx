"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { ARC_MAINNET_CHAIN_ID } from "@/lib/arc/config";
import { mapWalletError } from "@/lib/arc/wallet";

import { Button } from "./ui/button";
import { WalletProviders } from "./WalletProviders";

function truncate(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Navigation wallet control. Reuses the existing injected-connector wallet
 * stack; it performs no payment actions and cannot change a payment status.
 *
 * The wagmi provider is scoped to this component (and to PaymentFlow) rather
 * than the root layout, so the heavy wallet bundle is never part of the first
 * paint of a page that does not need it.
 */
function WalletButtonInner() {
  const { address, chainId, isConnected } = useAccount();
  const {
    connect,
    connectors,
    isPending: connecting,
    error: connectError,
  } = useConnect();
  const { disconnect } = useDisconnect();
  const {
    switchChain,
    isPending: switching,
    error: switchError,
  } = useSwitchChain();

  const [open, setOpen] = useState(false);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const mappedError = connectError
    ? mapWalletError(connectError, "connect").message
    : switchError
      ? mapWalletError(switchError, "switch").message
      : null;
  const message = localMessage ?? mappedError;

  const onConnect = useCallback(() => {
    setLocalMessage(null);
    const connector = connectors[0];
    if (!connector) {
      setLocalMessage(
        "No EVM wallet was detected. Install a browser wallet such as MetaMask.",
      );
      return;
    }
    connect({ connector });
  }, [connect, connectors]);

  if (!isConnected) {
    return (
      <div className="relative" ref={wrapperRef}>
        <Button
          size="sm"
          type="button"
          onClick={onConnect}
          disabled={connecting}
        >
          {connecting ? "[ CONNECTING… ]" : "[ CONNECT WALLET ]"}
        </Button>
        {message ? (
          <p
            role="status"
            className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 border border-border bg-black p-3 font-mono text-xs text-foreground/70"
          >
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  const wrongNetwork = chainId !== ARC_MAINNET_CHAIN_ID;

  return (
    <div className="relative" ref={wrapperRef}>
      <Button
        size="sm"
        variant="ghost"
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        {wrongNetwork ? "[ WRONG NETWORK ]" : `[ ${truncate(address ?? "")} ]`}
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+10px)] z-50 flex w-64 flex-col gap-3 border border-border bg-black p-4"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/50">
            Connected
          </p>
          <p className="font-mono text-xs break-all text-foreground/80">
            {address}
          </p>
          {wrongNetwork ? (
            <Button
              size="sm"
              type="button"
              role="menuitem"
              onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
              disabled={switching}
              className="w-full"
            >
              {switching ? "[ SWITCHING… ]" : "[ SWITCH TO ARC ]"}
            </Button>
          ) : (
            <p className="font-mono text-xs text-success">Arc Mainnet</p>
          )}
          <Button
            size="sm"
            variant="ghost"
            type="button"
            role="menuitem"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="w-full"
          >
            [ DISCONNECT ]
          </Button>
        </div>
      ) : null}

      {message ? (
        <p
          role="status"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 border border-border bg-black p-3 font-mono text-xs text-foreground/70"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** Wallet control wrapped in its own scoped wagmi provider. */
export function WalletButton() {
  return (
    <WalletProviders>
      <WalletButtonInner />
    </WalletProviders>
  );
}
