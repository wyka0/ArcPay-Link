import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

/**
 * SQLite database lifecycle for the durable payment store.
 *
 * SQLite is the smallest durable store that fits a single-node Node deployment
 * and needs no external credentials. The replay guarantee is enforced by a
 * database UNIQUE/PRIMARY KEY constraint, not by application code.
 *
 * LIMITATION: a local SQLite file is not shared across serverless instances and
 * may not survive ephemeral filesystems. Point `DATABASE_PATH` at a persistent
 * volume, or swap in a managed Postgres implementation of `PaymentRepository`,
 * before horizontal scaling.
 */

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS payments (
  id                TEXT PRIMARY KEY,
  amount_usdc       TEXT NOT NULL,
  amount_base_units TEXT NOT NULL,
  recipient         TEXT NOT NULL,
  description       TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'EXPIRED')),
  tx_hash           TEXT,
  payer             TEXT,
  created_at        TEXT NOT NULL,
  confirmed_at      TEXT,
  CHECK ((status = 'CONFIRMED') = (tx_hash IS NOT NULL))
);

-- A transaction hash can belong to only one payment.
CREATE UNIQUE INDEX IF NOT EXISTS payments_tx_hash_unique
  ON payments (tx_hash)
  WHERE tx_hash IS NOT NULL;

-- Authoritative claim ledger. The PRIMARY KEY is the atomic replay guard.
CREATE TABLE IF NOT EXISTS tx_claims (
  tx_hash    TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tx_claims_payment_id
  ON tx_claims (payment_id);
`;

/** Resolve the SQLite file path from the environment. */
export function resolveDatabasePath(): string {
  const explicit = process.env.DATABASE_PATH?.trim();
  if (explicit && explicit.length > 0) {
    return resolve(explicit);
  }

  const url = process.env.DATABASE_URL?.trim();
  if (url && url.startsWith("file:")) {
    return resolve(url.slice("file:".length));
  }

  return resolve(process.cwd(), "data", "arcpaylink.db");
}

/** Open (creating if needed) the database and apply migrations. */
export function openDatabase(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(MIGRATIONS);
  return db;
}

/** True when an error is a SQLite uniqueness/PK violation. */
export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT");
}
