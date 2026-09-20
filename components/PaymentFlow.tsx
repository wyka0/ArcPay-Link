"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import {
  useAccount,
  useConfig,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { ARC_MAINNET_CHAIN_ID, getArcUsdcAddress } from "@/lib/arc/config";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/arc/payment";
import {
  erc20Abi,
  formatUsdcAmountCompact,
  parseUsdcAmount,
} from "@/lib/arc/usdc";
import { mapWalletError } from "@/lib/arc/wallet";
import {
  deriveInitialState,
  failureMessage,
  isFlowActive,
  runPaymentFlow,
  type PaymentFailureCode,
  type PaymentFlowDeps,
  type PaymentFlowSnapshot,
  type ServerVerificationOutcome,
} from "@/lib/payments/payment-flow";
import type { PublicPayment } from "@/lib/payments/types";

import { Button } from "./ui/button";
import { WalletProviders } from "./WalletProviders";

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function displayAmount(amountUsdc: string): string {
  try {
    return formatUsdcAmountCompact(parseUsdcAmount(amountUsdc));
  } catch {
    return amountUsdc;
  }
}

/** Map the verify endpoint response into a flow outcome. */
function mapServerResponse(
  status: number,
  body: unknown,
): ServerVerificationOutcome {
  const data = (body ?? {}) as {
    payment?: { status?: string; payer?: string };
    reason?: string;
  };

  if (status === 200 && data.payment?.status === "CONFIRMED") {
    return { ok: true, payer: data.payment.payer ?? "" };
  }

  const knownReason = data.reason as PaymentFailureCode | undefined;
  const code: PaymentFailureCode =
    knownReason ?? (status === 409 ? "REPLAY_DETECTED" : "VERIFICATION_FAILED");

  return { ok: false, code, message: failureMessage(code) };
}

const STATUS_TEXT: Record<string, string> = {
  Pending: "text-foreground/60",
  Verifying: "text-primary",
  Confirmed: "text-success",
  Failed: "text-danger",
};

export function PaymentFlow({ payment }: { payment: PublicPayment }) {
  return (
    <WalletProviders>
      <PaymentFlowInner payment={payment} />
    </WalletProviders>
  );
}

function PaymentFlowInner({ payment }: { payment: PublicPayment }) {
  const router = useRouter();
  const config = useConfig();
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

  const [snapshot, setSnapshot] = useState<PaymentFlowSnapshot>({
    state: "CONNECT_WALLET",
  });
  const [localError, setLocalError] = useState<string | null>(null);

  const serverConfirmed = payment.status === "CONFIRMED";
  const derived = deriveInitialState({ isConnected, chainId });
  const state = isFlowActive(snapshot.state) ? snapshot.state : derived;

  const amountDisplay = useMemo(
    () => displayAmount(payment.amountUsdc),
    [payment.amountUsdc],
  );

  const amountBaseUnits = useMemo(() => {
    try {
      return parseUsdcAmount(payment.amountUsdc);
    } catch {
      return null;
    }
  }, [payment.amountUsdc]);

  const connectFailure = connectError
    ? mapWalletError(connectError, "connect")
    : null;
  const switchFailure = switchError
    ? mapWalletError(switchError, "switch")
    : null;

  const explorerLink = snapshot.txHash
    ? explorerTxUrl(snapshot.txHash)
    : payment.txHash
      ? explorerTxUrl(payment.txHash)
      : null;

  const onConnect = useCallback(() => {
    setLocalError(null);
    const connector = connectors[0];
    if (!connector) {
      setLocalError(
        "No EVM wallet was detected. Install a browser wallet such as MetaMask and reload.",
      );
      return;
    }
    connect({ connector });
  }, [connect, connectors]);

  const onSwitch = useCallback(() => {
    setLocalError(null);
    switchChain({ chainId: ARC_MAINNET_CHAIN_ID });
  }, [switchChain]);

  const onRetry = useCallback(() => {
    setLocalError(null);
    setSnapshot({ state: "READY" });
  }, []);

  const onPay = useCallback(async () => {
    if (state !== "READY") return;
    if (!amountBaseUnits) {
      setLocalError("The payment record has an invalid amount.");
      return;
    }
    setLocalError(null);

    const deps: PaymentFlowDeps = {
      sendUsdcTransfer: ({ recipient, amountBaseUnits: units }) =>
        writeContract(config, {
          address: getArcUsdcAddress(),
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipient, units],
          chainId: ARC_MAINNET_CHAIN_ID,
        }) as Promise<Hex>,
      waitForReceipt: async (txHash) => {
        const receipt = await waitForTransactionReceipt(config, {
          hash: txHash,
          chainId: ARC_MAINNET_CHAIN_ID,
        });
        return { status: receipt.status };
      },
      verifyOnServer: async ({ paymentId, txHash }) => {
        const response = await fetch(`/api/payments/${paymentId}/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ txHash }),
        });
        const body = await response.json().catch(() => null);
        return mapServerResponse(response.status, body);
      },
    };

    await runPaymentFlow(
      {
        paymentId: payment.id,
        recipient: payment.recipient as Address,
        amountBaseUnits,
      },
      deps,
      setSnapshot,
    );

    router.refresh();
  }, [amountBaseUnits, config, payment.id, payment.recipient, router, state]);

  const isConfirmed = serverConfirmed || snapshot.state === "CONFIRMED";
  const isFailed = snapshot.state === "FAILED";
  const isVerifying = snapshot.state === "VERIFYING";

  const statusLabel = isConfirmed
    ? "Confirmed"
    : isFailed
      ? "Failed"
      : isVerifying
        ? "Verifying"
        : "Pending";

  const submitting =
    snapshot.state === "SIGNING" ||
    snapshot.state === "SUBMITTED" ||
    snapshot.state === "VERIFYING";

  return (
    <div className="border border-border bg-black/70 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-5">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-foreground/50">
          Payment Request
        </p>
        <span
          className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] ${
            STATUS_TEXT[statusLabel] ?? ""
          }`}
        >
          <span
            className={`inline-block size-2 rounded-full bg-current ${
              isVerifying ? "arc-pulse" : ""
            }`}
          />
          {statusLabel}
        </span>
      </div>

      <div className="flex flex-col gap-8 px-6 py-8">
        <div className="flex flex-col gap-3">
          <p className="font-sentient text-5xl md:text-6xl leading-none">
            {amountDisplay}{" "}
            <span className="font-mono text-sm uppercase text-foreground/60">
              USDC
            </span>
          </p>
          <p className="font-mono text-sm text-foreground/60">
            {payment.description}
          </p>
        </div>

        <dl className="grid gap-4 font-mono text-xs">
          <div className="flex flex-col gap-1">
            <dt className="uppercase tracking-[0.18em] text-foreground/50">
              Recipient
            </dt>
            <dd className="text-foreground/80">
              <a
                href={explorerAddressUrl(payment.recipient)}
                target="_blank"
                rel="noopener noreferrer"
                title={payment.recipient}
                className="break-all hover:text-primary"
              >
                {truncateAddress(payment.recipient)}
              </a>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="uppercase tracking-[0.18em] text-foreground/50">
              Network
            </dt>
            <dd className="text-foreground/80">Arc Mainnet</dd>
          </div>
        </dl>

        {localError ? (
          <p
            role="alert"
            className="border border-danger/60 bg-danger/10 px-4 py-3 font-mono text-xs text-danger"
          >
            {localError}
          </p>
        ) : null}

        {isConfirmed ? (
          <ConfirmedBlock
            amountDisplay={amountDisplay}
            payer={snapshot.payer ?? payment.payer}
            explorerLink={explorerLink}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {state === "CONNECT_WALLET" ? (
              <>
                <Button type="button" onClick={onConnect} disabled={connecting}>
                  {connecting ? "[ CONNECTING… ]" : "[ CONNECT WALLET ]"}
                </Button>
                {connectFailure ? (
                  <p role="alert" className="font-mono text-xs text-danger">
                    {connectFailure.message}
                  </p>
                ) : null}
              </>
            ) : null}

            {state === "WRONG_NETWORK" ? (
              <>
                <p className="border border-border px-4 py-3 font-mono text-xs text-foreground/60">
                  Your wallet is on a different network. Switch to Arc mainnet
                  to continue. No transaction has been sent.
                </p>
                <Button type="button" onClick={onSwitch} disabled={switching}>
                  {switching ? "[ SWITCHING… ]" : "[ SWITCH TO ARC MAINNET ]"}
                </Button>
                {switchFailure ? (
                  <p role="alert" className="font-mono text-xs text-danger">
                    {switchFailure.message}
                  </p>
                ) : null}
              </>
            ) : null}

            {state === "READY" ? (
              <>
                <p className="flex items-center justify-between font-mono text-xs text-foreground/60">
                  <span className="inline-flex items-center gap-2 text-success">
                    <span className="inline-block size-2 rounded-full bg-current" />
                    Connected
                  </span>
                  <span className="break-all">
                    {address ? truncateAddress(address) : ""}
                  </span>
                </p>
                <Button type="button" onClick={onPay} disabled={submitting}>
                  {`[ PAY ${amountDisplay} USDC ]`}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => disconnect()}
                >
                  [ DISCONNECT ]
                </Button>
              </>
            ) : null}

            {snapshot.state === "SIGNING" ? (
              <p
                role="status"
                className="border border-border px-4 py-3 font-mono text-xs text-foreground/60"
              >
                Waiting for wallet approval…
              </p>
            ) : null}

            {snapshot.state === "SUBMITTED" ? (
              <div
                role="status"
                className="flex flex-col gap-2 border border-border px-4 py-3 font-mono text-xs text-foreground/60"
              >
                <span>Transaction submitted</span>
                {snapshot.txHash ? (
                  <span className="break-all text-foreground/50">
                    {snapshot.txHash}
                  </span>
                ) : null}
                <span>Waiting for Arc confirmation…</span>
              </div>
            ) : null}

            {snapshot.state === "VERIFYING" ? (
              <p
                role="status"
                className="border border-primary/60 px-4 py-3 font-mono text-xs text-primary"
              >
                Verifying payment… Waiting for independent
                <br />
                on-chain verification on Arc.
              </p>
            ) : null}

            {snapshot.state === "FAILED" ? (
              <>
                <div
                  role="alert"
                  className="flex flex-col gap-2 border border-danger/60 bg-danger/10 px-4 py-3 font-mono text-xs text-danger"
                >
                  <span className="uppercase tracking-[0.18em]">
                    Payment could not be verified
                  </span>
                  <span className="text-danger/90">
                    {snapshot.failure?.message ??
                      "The transaction did not satisfy the payment requirements."}
                  </span>
                </div>
                {snapshot.txHash ? (
                  <p className="break-all font-mono text-[11px] text-foreground/40">
                    {snapshot.txHash}
                  </p>
                ) : null}
                <Button type="button" variant="ghost" onClick={onRetry}>
                  [ TRY AGAIN ]
                </Button>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmedBlock({
  amountDisplay,
  payer,
  explorerLink,
}: {
  amountDisplay: string;
  payer?: string;
  explorerLink: string | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div
        role="status"
        className="flex flex-col items-center gap-2 border border-success/50 bg-success/10 px-4 py-6 text-center"
      >
        <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-success">
          <span className="inline-block size-2 rounded-full bg-current" />✓
          Payment Confirmed
        </span>
        <span className="font-sentient text-3xl">{amountDisplay} USDC</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/50">
          Verified on Arc mainnet
        </span>
      </div>

      {payer ? (
        <dl className="grid gap-4 font-mono text-xs">
          <div className="flex flex-col gap-1">
            <dt className="uppercase tracking-[0.18em] text-foreground/50">
              Payer
            </dt>
            <dd className="break-all text-foreground/80">
              <a
                href={explorerAddressUrl(payer)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
                {truncateAddress(payer)}
              </a>
            </dd>
          </div>
        </dl>
      ) : null}

      {explorerLink ? (
        <Button asChild variant="ghost">
          <a href={explorerLink} target="_blank" rel="noopener noreferrer">
            [ VIEW TRANSACTION ]
          </a>
        </Button>
      ) : null}
    </div>
  );
}
