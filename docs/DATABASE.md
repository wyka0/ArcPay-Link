# Database — Neon PostgreSQL + Prisma

ArcPay Link persists payments in **PostgreSQL (Neon)** through **Prisma**. This
replaced the earlier single-node SQLite store so the app can run safely on
serverless infrastructure such as Vercel.

The application code does not depend on which database is used: everything goes
through the `PaymentRepository` interface
(`lib/payments/repository.ts`).

## Versions

| Package                    | Version |
| -------------------------- | ------- |
| `prisma` (CLI)             | 7.10.0  |
| `@prisma/client`           | 7.10.0  |
| `@prisma/adapter-neon`     | 7.10.0  |
| `@neondatabase/serverless` | 1.1.0   |

Prisma 7 requires a driver adapter. This project uses the Neon serverless
adapter, which talks to Neon over WebSockets and is the recommended setup for
serverless environments (no TCP pool to exhaust).

> Note: at install time the `prisma` CLI's `latest` dist-tag pointed at an 8.x
> release candidate. Both packages are pinned to the stable **7.10.0** line.

## Data model

Two tables, mirroring the previous verified schema:

```prisma
model Payment {
  id              String   @id
  amountUsdc      String   @map("amount_usdc")
  amountBaseUnits String   @map("amount_base_units")
  recipient       String
  description     String
  status          String
  txHash          String?  @unique @map("tx_hash")
  payer           String?
  failureReason   String?  @map("failure_reason")
  createdAt       String   @map("created_at")
  confirmedAt     String?  @map("confirmed_at")

  @@index([createdAt])
  @@map("payments")
}

model TxClaim {
  txHash    String @id @map("tx_hash")
  paymentId String @map("payment_id")
  claimedAt String @map("claimed_at")

  @@index([paymentId])
  @@map("tx_claims")
}
```

Design decisions:

- **IDs stay strings.** `id` is an application-generated UUID, unchanged.
- **USDC amounts stay text.** `amountUsdc` is the canonical decimal string and
  `amountBaseUnits` is the exact 6-decimal integer as a string. No floating
  point anywhere.
- **Timestamps stay ISO-8601 strings.** The domain model is unchanged; precision
  is not lost because the values are produced by `new Date().toISOString()`.

## Constraints (replay protection)

Replay protection is enforced by the database, not by application code:

| Constraint                                  | Purpose                                           |
| ------------------------------------------- | ------------------------------------------------- |
| `tx_claims` PRIMARY KEY on `tx_hash`        | A transaction hash can be claimed once.           |
| `payments.tx_hash` UNIQUE (nullable)        | One payment per hash.                             |
| `payments_status_check`                     | Status is one of `PENDING`/`CONFIRMED`/`EXPIRED`. |
| `payments_confirmed_requires_tx_hash_check` | `CONFIRMED` ⇔ `tx_hash IS NOT NULL`.              |

PostgreSQL treats `NULL` values as distinct in a unique index, so many pending
payments may hold `NULL`. This is the exact PostgreSQL equivalent of the
previous partial index:

```sql
CREATE UNIQUE INDEX ... ON payments (tx_hash) WHERE tx_hash IS NOT NULL;
```

The last two constraints are added in the migration SQL because Prisma's schema
language cannot express `CHECK` constraints.

The claim itself runs in a single `prisma.$transaction`:

1. load the payment and fail if missing,
2. return idempotently if this payment already owns the hash,
3. reject if another payment owns the hash,
4. insert the `tx_claims` row (the atomic guard),
5. update the payment to `CONFIRMED`,
6. commit.

A losing concurrent writer receives a unique-constraint error (`P2002`), which
is mapped to `TransactionAlreadyClaimedError` (or to an idempotent success when
the same payment already owns the hash).

## Migrations

`prisma/migrations/` holds the SQL. To apply it:

```bash
# create/update the managed database during development (creates a migration)
npm run prisma:migrate:dev -- --name <change>

# apply committed migrations to any environment (production, CI)
npm run prisma:migrate:deploy
```

Other helpers:

```bash
npm run prisma:generate   # regenerate the client into lib/generated/prisma
npm run prisma:validate   # validate the schema
npm run prisma:studio     # browse data
```

`lib/generated/prisma/` is generated output and is git-ignored. `npm run build`
and `postinstall` regenerate it, so it is always present where it is needed.

## Creating a Neon database

1. Sign in at <https://neon.tech> and create a project (the free tier is enough).
2. Open **Connection Details** and copy the **pooled** connection string
   (the hostname contains `-pooler`). It looks like:
   `postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require`
3. Put it in `.env.local` (never commit it):
   ```bash
   DATABASE_URL="postgresql://...-pooler.../DBNAME?sslmode=require"
   ```
4. Apply the schema:
   ```bash
   npm run prisma:generate
   npm run prisma:migrate:deploy
   ```

## Deploying on Vercel

1. Import the GitHub repository into Vercel.
2. Add environment variables in **Project → Settings → Environment Variables**:
   - `DATABASE_URL` — the Neon **pooled** connection string.
   - `ARC_RPC_URL` — optional (defaults to the public Arc mainnet RPC).
   - `NEXT_PUBLIC_APP_URL` — the production URL.
3. Build command: `npm run build` (runs `prisma generate` first).
4. Run migrations against production once, from a machine with the production
   `DATABASE_URL`:
   ```bash
   npm run prisma:migrate:deploy
   ```

Serverless notes:

- No database state lives on the filesystem; there is no SQLite file and no
  `data/` directory in production.
- The Prisma client is cached on `globalThis` and uses the Neon serverless
  driver, so warm invocations reuse a connection and cold starts create the
  minimum needed.
- The legacy `DATABASE_PATH` variable is no longer used and can be removed.

## Local development

There is no local Postgres in this repository's toolchain. Options:

- Use a Neon branch/database for development (simplest), or
- Run Postgres locally and point `DATABASE_URL` at it.

`npm test` does **not** require a database: repository tests use deterministic
in-memory doubles. A separate optional integration test
(`tests/prisma-integration.test.ts`) runs only when `TEST_DATABASE_URL` is set.
