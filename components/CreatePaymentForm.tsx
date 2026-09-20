"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "./ui/button";

interface CreateResponse {
  id: string;
  status: string;
  paymentUrl: string;
  error?: string;
  issues?: { field: string; message: string }[];
}

export function CreatePaymentForm() {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [recipient, setRecipient] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setIssues([]);

    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsdc: amount, description, recipient }),
      });

      const data = (await response.json()) as CreateResponse;

      if (!response.ok) {
        setError(data.error ?? "Could not create payment link");
        setIssues((data.issues ?? []).map((issue) => issue.message));
        return;
      }

      setCreatedUrl(`${window.location.origin}${data.paymentUrl}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  if (createdUrl) {
    const path = new URL(createdUrl).pathname;
    return (
      <div className="flex flex-col gap-6 border border-border bg-black/70 p-6">
        <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-success">
          <span className="inline-block size-2 rounded-full bg-current" />
          Link ready
        </span>
        <h2 className="font-sentient text-3xl">Your payment link is live</h2>
        <p className="font-mono text-xs text-foreground/60">
          Share this URL. The payment stays pending until it is verified on Arc.
        </p>
        <p className="break-all border border-border bg-black p-4 font-mono text-xs text-foreground/80">
          {createdUrl}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button size="sm" type="button" onClick={copyLink}>
            {copied ? "[ COPIED ]" : "[ COPY LINK ]"}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href={path}>[ OPEN PAYMENT ]</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-8" onSubmit={onSubmit} noValidate>
      <div className="arc-field flex flex-col gap-2">
        <label
          htmlFor="amount"
          className="font-mono text-xs uppercase tracking-[0.18em] text-foreground/60"
        >
          Amount (USDC)
        </label>
        <input
          id="amount"
          inputMode="decimal"
          placeholder="5.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          required
        />
        <span className="font-mono text-[11px] text-foreground/50">
          Up to 6 decimal places.
        </span>
      </div>

      <div className="arc-field flex flex-col gap-2">
        <label
          htmlFor="description"
          className="font-mono text-xs uppercase tracking-[0.18em] text-foreground/60"
        >
          Description
        </label>
        <input
          id="description"
          placeholder="Design consultation"
          maxLength={200}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
        />
      </div>

      <div className="arc-field flex flex-col gap-2">
        <label
          htmlFor="recipient"
          className="font-mono text-xs uppercase tracking-[0.18em] text-foreground/60"
        >
          Recipient wallet
        </label>
        <input
          id="recipient"
          placeholder="0x…"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          required
        />
        <span className="font-mono text-[11px] text-foreground/50">
          The EVM address that receives the USDC on Arc mainnet.
        </span>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-2 border border-danger/60 bg-danger/10 px-4 py-3 font-mono text-xs text-danger"
        >
          <span>{error}</span>
          {issues.length > 0 ? (
            <ul className="ml-4 list-disc">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" loading={submitting}>
        {submitting ? "[ CREATING… ]" : "[ CREATE PAYMENT LINK ]"}
      </Button>
    </form>
  );
}
