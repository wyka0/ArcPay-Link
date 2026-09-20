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
before the payment is shown as confirmed. Confirmed payments are persisted in
**Neon PostgreSQL** through **Prisma**.

## How it works

1. A merchant creates a payment link.
2. A payer opens the link and sees the amount, description, recipient and
   network.
3. The payer's wallet submits `USDC.transfer(recipient, amount)` on Arc mainnet.
4. The app waits for the receipt and asks the server to verify it.
5. The server independently checks the transaction on Arc and, only if every
   check passes, marks the payment `CONFIRMED` and records the transaction hash.

## Architecture

Blockchain logic is isolated behind an Arc adapter, and persistence is isolated
behind a repository interface.

```text
app/                    Next.js routes and pages
  api/payments/         create + verify endpoints
  create/               create-payment page
  pay/[paymentId]/      payment page
components/             client UI
lib/arc/                Arc adapter (config, client, usdc, payment, verify)
lib/payments/           payment model, validation, repository, Prisma persistence
prisma/                 Prisma schema and migrations
docs/                   PRD, architecture, security, database
tests/                  unit, API and integration tests
```

How the layers fit together:

- **Prisma is the persistence layer.** The runtime repository is
  `PrismaPaymentRepository` (`lib/payments/prisma-repository.ts`).
- **Neon PostgreSQL is the database.** The Prisma client uses the Neon
  serverless driver (`@prisma/adapter-neon`).
- **`PaymentRepository` abstracts persistence.** Application and route code
  depends only on the interface (`lib/payments/repository.ts`), so the backing
  store can change without touching payment logic.
- **SQLite is no longer part of the production runtime.** A SQLite repository
  (`lib/payments/sqlite-repository.ts`) is retained only as legacy/test fixture
  coverage for the durable-persistence tests. Production uses PostgreSQL.

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

## Persistence

- Prisma 7 with the Neon serverless adapter.
- Neon PostgreSQL in production; no database state on the filesystem.
- `PaymentRepository` abstraction (`lib/payments/repository.ts`).
- `payments` table — one row per payment link, with a nullable `tx_hash`.
- `tx_claims` table — one row per claimed transaction hash.
- `payments.tx_hash` is `UNIQUE` (nullable) and `tx_claims.tx_hash` is the
  `PRIMARY KEY`, so a transaction hash can belong to at most one payment.
- Atomic claiming runs inside a single PostgreSQL transaction; a losing
  concurrent writer receives a unique-constraint error, which is mapped to
  `TransactionAlreadyClaimedError` (or to an idempotent success when the same
  payment already owns the hash).
- `CHECK` constraints enforce the status domain and that `CONFIRMED` implies a
  non-null `tx_hash`.

Schema, migrations and Neon setup are documented in
[`docs/DATABASE.md`](docs/DATABASE.md).

## Local development

Requirements: Node.js 20.9+ (developed on Node 24) and npm.

```bash
npm install
cp .env.example .env.local   # then set DATABASE_URL to a Neon/PostgreSQL URL
npm run dev
```

Open <http://localhost:3000>.

## Environment variables

`ARC_RPC_URL`

- Optional.
- Arc RPC used by the server-side verifier.
- Defaults to <https://rpc.mainnet.arc.io>.

`ARC_USDC_ADDRESS`

- Optional.
- Expected Arc mainnet USDC contract.
- Defaults to `0x3600000000000000000000000000000000000000`.

`NEXT_PUBLIC_APP_URL`

- Required for deployed environments.
- Public base URL used to generate shareable payment links.

`DATABASE_URL`

- Required.
- Neon PostgreSQL / PostgreSQL connection string.
- Use the pooled Neon connection string for the Vercel/serverless runtime.

`TEST_DATABASE_URL`

- Optional.
- Separate PostgreSQL database used by the live Prisma integration tests.
- If unset, the live integration tests are skipped.

Never commit `.env.local` or database credentials. `.env*` files are
git-ignored (except `.env.example`), and only `NEXT_PUBLIC_` values are exposed
to the browser.

## Testing

```bash
npm test          # run the test suite once (vitest)
npm run test:watch
npm run typecheck # next typegen && tsc --noEmit
npm run lint      # eslint
npm run format:check
npm run build     # prisma generate && next build
```

**116 tests pass across 11 files.** The suite covers:

- USDC amount conversion
- address validation
- create-payment validation
- verification decision logic
- live-boundary failure paths
- the wallet payment-flow state machine
- durable persistence
- PostgreSQL persistence
- atomic claim concurrency
- transfer-time binding
- replay protection
- the create/verify APIs
- database constraints

The live PostgreSQL integration suite runs separately and requires
`TEST_DATABASE_URL`:

- **6/6 live Prisma integration tests passed against Neon PostgreSQL.**
- Concurrent transaction claims were verified against real PostgreSQL — exactly
  one owner succeeds.
- Same payment + same transaction hash is idempotent.
- Different payment + same transaction hash is rejected.
- Database `CHECK` constraints were verified.
- Integration data was cleaned up after verification.

## Deployment

Current status:

- **GitHub repository:** public.
- **Neon PostgreSQL:** configured and live-verified.
- **Vercel deployment:** **not yet deployed.**

Intended deployment architecture:

```text
Vercel
  |
  v
Next.js
  |
  v
Prisma
  |
  v
Neon PostgreSQL
  |
  v
Arc mainnet RPC
  |
  v
Arc USDC
```

Deployment steps:

1. Configure `DATABASE_URL` in Vercel (the pooled Neon connection string).
2. Configure `NEXT_PUBLIC_APP_URL` with the production URL.
3. Configure `ARC_RPC_URL` only if overriding the default public endpoint.
4. Configure `ARC_USDC_ADDRESS` only if overriding the verified default.
5. Run Prisma migrations using the production migration workflow
   (`npm run prisma:migrate:deploy`).
6. Deploy.
7. Perform production payment verification.
8. Test replay protection on the deployed environment.

## Security

The app is non-custodial, stores no private keys, and verifies payments
server-side against Arc. It fails closed.

- **Server-side verification is authoritative.** The client cannot mark a
  payment `CONFIRMED`; only the server's on-chain checks can.
- **Wrong chain fails closed.**
- **Wrong token fails closed.**
- **Wrong recipient fails closed.**
- **Wrong amount fails closed.**
- **Reverted or unknown transactions fail closed.**
- **Invalid or missing block timestamps fail closed.**
- **Replay protection is enforced using PostgreSQL persistence and
  transaction/unique constraints.** A transaction hash can be claimed once.
- **Transaction claims are atomic** — concurrent claims cannot create two
  owners.
- **No private keys are stored by the application.**

Read [`docs/SECURITY.md`](docs/SECURITY.md) before deploying.

## Known limitations

- **No expiry enforcement yet** even though the `EXPIRED` status exists.
- **Transfer-time binding** uses the Arc block timestamp and allows the existing
  120-second clock-skew tolerance.
- **Direct `USDC.transfer` only** — contract-routed payments are rejected.
- **Rate limiting is not implemented yet.**
- **Vercel production deployment has not yet been completed.**
- **Production post-deployment E2E still needs to be run** against the deployed
  URL.
- **The app relies on the public Arc RPC endpoint** unless `ARC_RPC_URL` is
  configured otherwise.

## Status

Arc Microgrants MVP — implementation complete and deployment-ready.

Payment creation, wallet connection, real `USDC.transfer`, server-side Arc
verification, Prisma persistence, Neon PostgreSQL, and PostgreSQL-backed replay
protection are implemented and verified.

116 tests pass, including live PostgreSQL integration tests.

A real Arc mainnet payment has been successfully verified as `CONFIRMED`, and
replay of the same transaction against another payment was rejected with
HTTP 409 `REPLAY_DETECTED`.

Real E2E transaction (Arc mainnet):

```text
0x73317c46072d3acd85433d73127d2d50739edc6e8dc6fe61c6e349b82edc593f
```

- Block: `21667154`
- Transfer: `0.001000 USDC`
- Server verification result: `CONFIRMED`
- Replay result: HTTP 409 `REPLAY_DETECTED`

The remaining milestone is production deployment and final production E2E
verification.
