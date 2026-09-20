# ArcPay Link — Security

ArcPay Link is an Arc Microgrants MVP. This document describes its security
model and its known limitations. The guiding rule is **fail closed**: if the
application cannot prove a payment, it does not mark it confirmed.

## Non-custodial architecture

- ArcPay Link never holds, moves or has custody of user funds.
- The payer's own wallet signs and submits `USDC.transfer(recipient, amount)`
  directly to the recipient on Arc mainnet.
- The application only creates payment requests and verifies transactions that
  already happened.

## Wallet signing

- Signing happens in the user's EVM wallet. The transaction is constructed from
  the payment's recipient and amount and encoded by the Arc adapter.
- The backend has no signing capability and no transaction-sending code path.
- Only the injected connector is supported, so no WalletConnect project id or
  third-party credential is required or stored.
- The UI blocks payment unless the connected chain is Arc mainnet (`5042`). It
  never submits on another chain and offers an explicit switch instead.

## No private keys stored

- The application stores no private keys, seed phrases or signer credentials.
- `ARC_RPC_URL` and `ARC_USDC_ADDRESS` are optional configuration, not secrets.
- If a future feature needs a signing key, it must be introduced explicitly and
  documented, not invented.

## Server-side verification

A payment may only reach `CONFIRMED` through `POST
/api/payments/[id]/verify`, which calls `verifyPayment` on the server. The
frontend cannot set status. Creating a payment ignores any client-supplied
`status` field. The UI only reflects the status returned by the server.

## Verification checks

`verifyPayment` / `evaluateTransferReceipt` establish all of the following:

1. **Transaction exists** — `getTransactionReceipt` returns a receipt.
2. **Chain id** — the chain id reported by the RPC equals Arc mainnet (`5042`).
3. **Success** — receipt `status === "success"`.
4. **USDC transfer present** — at least one `Transfer` event.
5. **Token contract** — the emitting contract address equals the configured Arc
   mainnet USDC address (case-insensitive).
6. **Exact recipient** — a transfer `to` equals the payment recipient.
7. **Exact amount** — that transfer's `value` equals the requested amount in
   base units, exactly (never `>=`, never approximate).
8. **Payer identified** — the `from` address is read from the event.
9. **Transfer after payment creation** — the transfer's Arc block timestamp must
   be at or after `payment.createdAt`, minus a small clock-skew tolerance
   (`PAYMENT_TRANSFER_TOLERANCE_SECONDS`, 120 s). The timestamp is read from the
   Arc block via RPC and is never supplied by the client. A missing block
   timestamp fails closed (`TRANSFER_TIME_UNKNOWN`), and a transfer that predates
   the request is rejected (`TRANSFER_BEFORE_PAYMENT`).
10. **Not already claimed** — the transaction hash is not bound to another
    payment.

Any failed or uncertain check keeps the payment `PENDING`.

### Live mainnet evidence

The verifier has been exercised against live Arc mainnet without fabricating a
successful payment. Real mainnet transactions were rejected and left `PENDING`:

- an unrelated Arc transaction → `NO_USDC_TRANSFER`
- a real Arc USDC transfer to a different address → `WRONG_RECIPIENT`
- a real Arc USDC transfer for a different amount → `WRONG_AMOUNT`
- a real Arc transaction whose block timestamp predates a freshly created
  payment → `TRANSFER_BEFORE_PAYMENT`

The success path against a real funded transfer has not yet been run; it is
`BLOCKED` on a funded developer wallet.

## Verification is deterministic

The decision function `evaluateTransferReceipt` is pure: given the same receipt
and payment it always returns the same result. All network access is confined to
`verifyPayment`, which maps every exception to `RPC_UNAVAILABLE` rather than to
success.

## Transaction replay / double-claim protection

Payments are stored in a durable **PostgreSQL (Neon)** database accessed through
Prisma. Replay protection is enforced by database constraints, not by
application checks:

- `tx_claims.tx_hash` is a `PRIMARY KEY`, so a hash can be inserted once.
- `payments.tx_hash` is `UNIQUE` and nullable. PostgreSQL treats `NULL`s as
  distinct, so many pending payments may hold `NULL` while a non-null hash
  belongs to at most one payment (the equivalent of the previous partial index
  `... WHERE tx_hash IS NOT NULL`).
- A `CHECK` constraint enforces `CONFIRMED` ⇔ `tx_hash IS NOT NULL`.

`claim` runs inside a single `prisma.$transaction`. A concurrent insert of the
same hash fails with a unique-constraint error (`P2002`), which is mapped to
`TransactionAlreadyClaimedError` and returned as HTTP `409`. The verify route
also checks the claim index before contacting the RPC, but the database
constraint is the final authority: even if two processes pass the pre-check at
the same time, exactly one claim can commit.

Ordering is fixed: on-chain verification first, then the atomic claim, then
`CONFIRMED`. A failed claim never yields a confirmation.

Evidence: `tests/prisma-repository.test.ts` exercises concurrent claims against
a deterministic in-memory double with PostgreSQL transaction semantics (both
the application pre-check path and the unique-violation/P2002 path), and
`tests/durable-repository.test.ts` retains the earlier multi-thread constraint
proof. `tests/prisma-integration.test.ts` runs the full create/retrieve/claim/
idempotent/replay/concurrency suite against a real database when
`TEST_DATABASE_URL` is set.

LIMITATION: the live PostgreSQL/Neon verification of the migration has not yet
been run (no database was available in the build environment). Until it is, the
database-level guarantee is exercised against the in-memory database double and
the legacy SQLite proof. Do not disable the uniqueness constraint.

## Input validation

- `amountUsdc` must be a positive decimal string with at most 6 decimal places
  and at or below the configured maximum. It is parsed with `bigint`, never
  floating point.
- `recipient` must be a valid EVM address; it is normalised to lower case.
- `description` must be non-empty and at most 200 characters.
- `txHash` must match `^0x[0-9a-fA-F]{64}$`.
- Malformed JSON bodies are rejected with `400`.

## RPC failure behaviour

- Any RPC error, timeout or unexpected exception results in `{ ok: false,
reason: "RPC_UNAVAILABLE" }` and HTTP `503`. The payment stays `PENDING` and
  the client may retry.
- The verifier never treats a missing or errored receipt as a success.

## Secret handling

- No secrets are committed. `.env*` is git-ignored except `.env.example`.
- Only configuration explicitly prefixed `NEXT_PUBLIC_` may reach the browser.
- Server-only configuration (`ARC_RPC_URL`, `DATABASE_URL`) is read on the
  server only.
- Errors returned to clients are generic and never include stack traces or
  internal details.

## Suggested rate limiting

Not yet implemented. Before public deployment, apply rate limiting to
`POST /api/payments` (creation abuse) and `POST /api/payments/[id]/verify`
(RPC amplification), for example per-IP and per-route token buckets at the edge
or in a middleware layer.

## Known limitations

1. **Live database verification pending.** The PostgreSQL/Neon migration is
   implemented and tested against a deterministic in-memory double, but the
   migration and concurrency behaviour have not yet been executed against a live
   Neon database. Run `npm run prisma:migrate:deploy` and
   `TEST_DATABASE_URL=... npm test` before production use. Never remove the
   `txHash` uniqueness constraint.
2. **No expiry enforcement yet.** The `EXPIRED` status exists but nothing
   expires payments automatically.
3. **Direct transfers only.** The verifier accepts a direct `USDC.transfer`. A
   payment routed through another contract is rejected as `WRONG_TOKEN`.
4. **No wallet allow/deny checks.** The app does not screen payer addresses.
5. **Clock-skew tolerance.** Transfer-time binding tolerates up to 120 seconds of
   backdating to absorb server/wallet/provider clock differences. A transfer
   made within that window before the payment was created would still be
   accepted. The window is intentionally small and configurable via
   `PAYMENT_TRANSFER_TOLERANCE_SECONDS`.
6. **No reorg handling beyond receipts.** A very deep reorg after confirmation
   is not reconciled.
7. **No authentication.** Anyone with a payment id can view a payment request.
   Ids are random UUIDs and are not guessable, but the record contains no
   sensitive data.
8. **Rate limiting absent** (see above).

## Reporting

This is a grant MVP. Do not use it to move funds you cannot afford to lose while
the limitations above remain. Report issues through the repository issue tracker.
