# ArcPay Link

Simple USDC payment links on **Arc mainnet**.

Create a payment link. Share it. Get paid. ArcPay Link is **non-custodial**:
the payer's wallet sends USDC directly to the recipient, and the application
only marks a payment confirmed after it has independently verified the
transaction on Arc.

## What it is

A small Next.js + TypeScript app that turns an amount in USDC, a description and
a recipient address into a shareable link. A payer opens the link, pays the exact
amount in USDC on Arc mainnet, and the server verifies the resulting transaction
before the payment is shown as confirmed.

## How it works

1. A merchant creates a payment link.
2. A payer opens the link and sees the amount, description, recipient and
   network.
3. The payer's wallet submits `USDC.transfer(recipient, amount)` on Arc mainnet.
4. The app waits for the receipt and asks the server to verify it.
5. The server independently checks the transaction on Arc and, only if every
   check passes, marks the payment `CONFIRMED`.

## Architecture

Blockchain logic is isolated behind an Arc adapter.

```text
app/                    Next.js routes and pages
  api/payments/         create + verify endpoints
  create/               create-payment page
  pay/[paymentId]/      payment page
components/             client UI
lib/arc/                Arc adapter (config, client, usdc, payment, verify)
lib/payments/           payment model, validation, durable repository, replay protection
docs/                   PRD, architecture, security
tests/                  unit and API tests
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

## Arc integration

All Arc values live in `lib/arc/config.ts`, verified against the official docs:

| Parameter              | Value                                        |
| ---------------------- | -------------------------------------------- |
| Chain id               | `5042`                                       |
| RPC                    | `https://rpc.mainnet.arc.io`                 |
| Explorer               | `https://explorer.arc.io`                    |
| Native gas token       | USDC (18 decimals)                           |
| USDC ERC-20 interface  | `0x3600000000000000000000000000000000000000` |
| USDC transfer decimals | `6`                                          |

Sources:

- <https://docs.arc.io/arc/references/connect-to-arc>
- <https://docs.arc.io/arc/references/contract-addresses>

> Arc's native gas token is USDC with 18 decimals, while the USDC ERC-20
> interface uses 6 decimals. Payment amounts always use the ERC-20 interface and
> 6 decimals. Never mix the two.

## Local development

Requirements: Node.js 20.9+ (developed on Node 24) and npm.

```bash
npm install
cp .env.example .env.local   # optional; sane defaults are built in
npm run dev
```

Open <http://localhost:3000>.

## Environment variables

| Variable              | Required | Purpose                                                    |
| --------------------- | -------- | ---------------------------------------------------------- |
| `ARC_RPC_URL`         | No       | Arc RPC used by the verifier. Defaults to public mainnet.  |
| `ARC_USDC_ADDRESS`    | No       | Expected USDC contract. Defaults to verified mainnet.      |
| `NEXT_PUBLIC_APP_URL` | No       | Public base URL for links.                                 |
| `DATABASE_PATH`       | No       | Durable SQLite file. Defaults to `./data/arcpaylink.db`.   |
| `DATABASE_URL`        | No       | Reserved for managed Postgres; a `file:` URL means SQLite. |

Never commit secrets. Only `NEXT_PUBLIC_` values are exposed to the browser. See
[`.env.example`](.env.example).

## Testing

```bash
npm test          # run the test suite once (vitest)
npm run test:watch
npm run typecheck # next typegen && tsc --noEmit
npm run lint      # eslint
npm run format:check
npm run build     # production build
```

The suite covers USDC amount conversion, address validation, create-payment
validation, the verification decision logic, live-boundary failure paths, the
wallet payment-flow state machine, durable persistence, atomic claim
concurrency, transfer-time binding, replay protection and the create/verify
APIs. There are 97 tests across 9 files.

## Deployment

Deploy the Next.js app (for example to Vercel or any Node host) and set the
environment variables above. Then verify the production URL against Arc mainnet
as described in `docs/PRD.md`.

Not yet deployed.

## Security

The app is non-custodial, stores no private keys, and verifies payments
server-side against Arc. It fails closed. Read
[`docs/SECURITY.md`](docs/SECURITY.md) before deploying.

## Known limitations

- **Single-node SQLite.** Persistence is durable across restarts, but a local
  SQLite file is not shared across serverless instances. Use a persistent volume
  or the Postgres adapter before scaling out.
- **No expiry enforcement yet** even though the `EXPIRED` status exists.
- **Transfer-time binding** uses the Arc block timestamp and tolerates up to 120
  seconds of clock skew before payment creation.
- **Direct `USDC.transfer` only** — contract-routed payments are rejected.
- **Rate limiting not implemented.**
- **The live mainnet success path has not been executed end-to-end** because the
  build environment has no funded developer wallet. The verifier has been
  exercised against live Arc mainnet and correctly rejects real transactions.
- **Not deployed.**

## Status

Arc Microgrants MVP. Payment creation, wallet connection, the real
`USDC.transfer`, server-side verification and durable replay-protected
persistence are implemented and unit tested. Nothing here fabricates
transactions, hashes or balances. A payment is only ever confirmed from on-chain
evidence.
