# ArcPay Link — Product Requirements

## Problem

Accepting a stablecoin payment should be as simple as sending a link. Today a
merchant who wants to be paid in USDC must share an address, agree an amount,
and manually check a block explorer for the transfer. That is error prone and
does not scale.

## Product

ArcPay Link is a small, non-custodial web app for USDC payment links on **Arc
mainnet**.

> A user creates a payment link for a specified USDC amount and recipient.
> Another user opens the link, connects an EVM wallet, pays the exact amount in
> USDC on Arc mainnet, and the application verifies the payment on-chain before
> marking it confirmed.

## Goals

- Create a payment link from an amount, a description and a recipient.
- Let a payer pay the exact amount in USDC on Arc mainnet from their own wallet.
- Independently verify the transaction on Arc before showing `CONFIRMED`.
- Fail closed: if verification cannot prove the payment, the payment stays
  `PENDING`.
- Keep the MVP small and honest.

## Non-goals (MVP)

- No custom escrow smart contract.
- No custody of user funds.
- No accounts, login or KYC.
- No fiat on/off ramp.
- No multi-chain support.
- No refunds or disputes.
- No webhook delivery to merchants.

## User flows

### Merchant

1. Open the landing page.
2. Choose **Create Payment**.
3. Enter amount (USDC), description and recipient wallet.
4. Create the link.
5. Copy and share the URL.

### Customer

1. Open the payment URL.
2. See the amount, description, recipient and network (`Arc Mainnet`).
3. Connect an EVM wallet.
4. Pay the exact amount in USDC.
5. The wallet signs and submits the transaction.
6. The app waits for a receipt.
7. The server verifies the transaction against Arc.
8. The payment shows `CONFIRMED`.

## Functional requirements

| ID  | Requirement                                                                 |
| --- | --------------------------------------------------------------------------- |
| F1  | `POST /api/payments` creates a `PENDING` payment from validated input.      |
| F2  | Payment ids are unguessable and never derived from user input.              |
| F3  | `GET /pay/[paymentId]` renders amount, description, recipient and status.   |
| F4  | The payer wallet submits `USDC.transfer(recipient, amount)` on Arc mainnet. |
| F5  | `POST /api/payments/[id]/verify` verifies the transaction against Arc.      |
| F6  | A payment only becomes `CONFIRMED` after verification succeeds.             |
| F7  | One transaction hash can satisfy at most one payment.                       |
| F8  | Amounts are handled as integers (6-decimal base units), never floats.       |

## Data model

```ts
type PaymentStatus = "PENDING" | "CONFIRMED" | "EXPIRED";

interface Payment {
  id: string;
  amountUsdc: string; // canonical decimal, e.g. "5.000000"
  amountBaseUnits: string; // exact base units, e.g. "5000000"
  recipient: string;
  description: string;
  status: PaymentStatus;
  txHash?: string;
  payer?: string;
  createdAt: string;
  confirmedAt?: string;
}
```

## API

### `POST /api/payments`

Request:

```json
{ "amountUsdc": "5.00", "description": "Design work", "recipient": "0x…" }
```

Response `201`:

```json
{
  "id": "payment_id",
  "status": "PENDING",
  "paymentUrl": "/pay/payment_id"
}
```

Validation: valid EVM address, amount > 0, at most 6 decimals, amount at or
below the configured maximum, non-empty description (max 200 characters). A
client-supplied `status` is ignored.

### `POST /api/payments/[id]/verify`

Request:

```json
{ "txHash": "0x…" }
```

Response `200` with the confirmed payment, `422` when verification fails, `409`
when the transaction was already claimed, `503` when the RPC is unavailable.

## Acceptance criteria

- Creating a payment with valid input yields a shareable link.
- Paying the exact amount on Arc mainnet and verifying produces `CONFIRMED`.
- Any of the following keeps the payment `PENDING` or fails the request: wrong
  chain, wrong token, wrong recipient, wrong amount, reverted transaction,
  unknown transaction, reused transaction, RPC unavailable.

## Current implementation status

Payment creation, durable persistence, the wallet payment flow (injected
connector, Arc network guard, real `USDC.transfer`) and the verification core
are implemented and unit tested. Replay protection is enforced by database
constraints with a concurrency test. The verifier has been exercised against
live Arc mainnet and correctly rejects real transactions. The live success path
with a funded wallet and the deployment are the remaining steps.
