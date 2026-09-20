# ArcPay Link — Architecture

## Overview

ArcPay Link is a Next.js (App Router) + TypeScript application. It is
non-custodial: the payer's wallet signs the USDC transfer directly to the
recipient. The application only creates payment requests and verifies the
resulting transaction.

```text
Browser (payer)                Next.js server                 Arc mainnet
──────────────                 ──────────────                 ───────────
Create form ──POST /api/payments──▶ validate
                                    repository.create()
                                          │
                                          ▼
                                    PENDING record
                                    payment URL

Open /pay/[id] ─────────────▶ repository.getById()
                                    └──────────────▶ render request

Connect wallet
USDC.transfer() ───────────────────────────────────────────────▶ Arc RPC
      │                                                              │
      │ tx hash                                                      │ receipt
      ▼                                                              ▼
POST /api/payments/[id]/verify ──▶ verifyPayment() ────────────▶ Arc RPC
                                        │
                                        ├─ fail closed ──▶ PENDING (unchanged)
                                        └─ all checks pass
                                              repository.claim()
                                              CONFIRMED
```

## Layers

| Layer              | Location                                | Responsibility                                     |
| ------------------ | --------------------------------------- | -------------------------------------------------- |
| Arc adapter        | `lib/arc/`                              | Chain config, RPC client, USDC math, verification. |
| Wallet integration | `lib/arc/wallet.ts`, `lib/arc/wagmi.ts` | Chain guard, error mapping, wagmi config.          |
| Payment domain     | `lib/payments/`                         | Types, validation, persistence, replay protection. |
| Payment flow       | `lib/payments/payment-flow.ts`          | Pure state machine for one payment attempt.        |
| HTTP boundary      | `app/api/payments/`                     | Thin route handlers over the domain.               |
| UI                 | `app/`, `components/`                   | Landing, create and wallet payment pages.          |

Blockchain details are isolated behind the Arc adapter. The rest of the app does
not import viem directly except for encoding/decoding inside the adapter.

### `lib/arc`

- **`config.ts`** — one central source for chain id, RPC URL, explorer URL and
  the USDC contract address. Values were verified against the official Arc docs.
- **`client.ts`** — a read-only viem public client. Signing never happens here.
- **`usdc.ts`** — integer-only USDC amount parsing/formatting, address
  validation and the minimal ERC-20 ABI.
- **`payment.ts`** — encodes the unsigned `transfer` call and builds explorer
  URLs; chain-id guard.
- **`wallet.ts`** — framework-agnostic wallet helpers: the Arc chain guard and
  mapping of wallet/RPC errors to stable, user-safe failure codes. No wagmi
  import, so it stays unit testable.
- **`wagmi.ts`** — the wagmi config: Arc as the single chain and the injected
  connector only, so no third-party project id is needed.
- **`verify.ts`** — the verification boundary. `evaluateTransferReceipt` is a
  pure, deterministic decision function; `verifyPayment` fetches the receipt and
  applies it, failing closed on any RPC error.

### `lib/payments`

- **`types.ts`** — the payment model and a `toPublicPayment` projection that
  never leaks internal fields.
- **`validation.ts`** — validates untrusted create-payment payloads. A
  client-provided status is never trusted.
- **`repository.ts`** — the persistence contract and its errors.
- **`database.ts`** — opens SQLite (creating the file if needed), applies the
  schema, and exposes constraint helpers.
- **`sqlite-repository.ts`** — the durable implementation. The atomic claim runs
  in a single SQLite transaction; `tx_claims.tx_hash` (PRIMARY KEY) and the
  partial `payments.tx_hash` UNIQUE index are the final replay guards.
- **`memory-repository.ts`** — an in-memory double used only by unit tests.
- **`index.ts`** — the lazily created repository singleton and test override.
- **`payment-flow.ts`** — the pure payment-attempt state machine
  (`deriveInitialState`, `runPaymentFlow`) with injected side effects, so the
  whole flow is deterministic and testable without a wallet or a chain.

## Persistence and replay protection

The durable store is **SQLite** via `better-sqlite3` (`serverExternalPackages`).
It was chosen because it is the smallest durable relational store that needs no
external credentials, fits a single-node Node deployment, and enforces the
uniqueness guarantee with a real database constraint. A managed Postgres
implementation can substitute the same `PaymentRepository` interface without
touching the verifier or the routes.

Schema (see `lib/payments/database.ts`):

```sql
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  amount_usdc TEXT NOT NULL,
  amount_base_units TEXT NOT NULL,
  recipient TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'EXPIRED')),
  tx_hash TEXT,
  payer TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  CHECK ((status = 'CONFIRMED') = (tx_hash IS NOT NULL))
);

CREATE UNIQUE INDEX payments_tx_hash_unique
  ON payments (tx_hash) WHERE tx_hash IS NOT NULL;

CREATE TABLE tx_claims (
  tx_hash TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);
```

Nullable `tx_hash` is deliberate: many PENDING payments have `NULL`, while a
non-null hash can occur at most once. The claim order is always:

```text
blockchain verification -> verified result -> atomic txHash claim -> CONFIRMED
```

If the claim conflicts, the payment is **not** confirmed. The claim is proven
under real concurrency by a test that races eight worker threads against the
same hash; exactly one wins and the rest receive a constraint conflict.

LIMITATION: a local SQLite file is not shared across serverless instances. For
multi-instance deployment, point `DATABASE_PATH` at persistent storage or
implement the Postgres adapter; the interface and schema are ready.

## Wallet payment flow

`components/PaymentFlow.tsx` wires wagmi (injected connector) to the pure state
machine. The explicit states are:

```text
CONNECT_WALLET -> READY -> SIGNING -> SUBMITTED -> VERIFYING -> CONFIRMED
                    |          |           |            |
              WRONG_NETWORK    +-----------+------------+--> FAILED
```

- `CONNECT_WALLET` — no wallet connected.
- `WRONG_NETWORK` — connected, but not chain `5042`. The UI offers an explicit
  switch and never submits on another chain.
- `READY` — connected to Arc mainnet; the Pay button is enabled.
- `SIGNING` — the user clicked Pay; waiting for wallet approval. Duplicate
  submission is disabled.
- `SUBMITTED` — a transaction hash was returned. Not confirmation.
- `VERIFYING` — the receipt succeeded and `POST /api/payments/[id]/verify` is
  running.
- `CONFIRMED` — the server independently verified the transaction.
- `FAILED` — a user-safe failure code is shown; nothing is confirmed.

A successful receipt alone never produces `CONFIRMED`: the client still calls
the server verifier and waits for its verdict.

## Arc integration

| Parameter              | Value                                        |
| ---------------------- | -------------------------------------------- |
| Chain id               | `5042`                                       |
| RPC                    | `https://rpc.mainnet.arc.io`                 |
| Explorer               | `https://explorer.arc.io`                    |
| Native gas token       | USDC (18 decimals)                           |
| USDC ERC-20 interface  | `0x3600000000000000000000000000000000000000` |
| USDC transfer decimals | `6`                                          |

Verified against:

- <https://docs.arc.io/arc/references/connect-to-arc>
- <https://docs.arc.io/arc/references/contract-addresses>

Arc uses USDC as the native gas token with 18 decimals, while the USDC ERC-20
interface uses 6 decimals. Payment amounts always use the **ERC-20** interface
and 6 decimals. The two must never be mixed.

## Verification model

`evaluateTransferReceipt` is a pure function. Given an observed chain id and a
transaction receipt, it checks, in order:

1. The observed chain id equals Arc mainnet (`5042`).
2. The receipt status is `success`.
3. The payment record's amount parses to valid base units.
4. At least one USDC `Transfer` event was emitted by the expected USDC address.
5. A USDC transfer exists whose `to` equals the payment recipient.
6. A transfer to the recipient has `value` exactly equal to the expected amount.
7. The payer (`from`) is recoverable from the event.
8. The transfer's Arc block timestamp is at or after `payment.createdAt` minus
   the small clock-skew tolerance. A missing timestamp fails closed.

`verifyPayment` reads the chain id, the receipt and the block timestamp from Arc,
then adds the transaction-existence check and the replay check. Any exception
becomes `{ ok: false, reason: "RPC_UNAVAILABLE" }`.

## Replay protection

The repository keeps a `txHash -> paymentId` index. `claim` is the only way to
reach `CONFIRMED`, and it refuses to bind a transaction hash that is already
bound to a different payment. The verify route also checks the index before
contacting the RPC.

## Failure behaviour

The system fails closed. If the RPC is unavailable, the transaction is unknown,
the receipt has not landed yet, or any check fails, the payment remains
`PENDING`. The UI never derives `CONFIRMED` from frontend state.

## Known structural limitations

- Persistence is durable single-node SQLite. A local file is not shared across
  serverless instances; see `docs/SECURITY.md`.
- Transfer-time binding tolerates up to 120 seconds of clock skew. A transfer in
  that small window before payment creation is still accepted.
- The MVP accepts only a direct `USDC.transfer`, not contract-routed payments.
