import { parentPort, workerData } from "node:worker_threads";

import Database from "better-sqlite3";

/**
 * Worker used by the concurrency test. It performs the same database-level
 * claim sequence as the repository from a separate connection on its own
 * thread, so several attempts genuinely race. The `tx_claims` PRIMARY KEY is
 * the final guard.
 */
const { dbPath, paymentId, txHash } = workerData;

function attempt() {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 10000");
  const key = String(txHash).toLowerCase();

  try {
    const run = db.transaction(() => {
      const owner = db
        .prepare("SELECT payment_id FROM tx_claims WHERE tx_hash = ?")
        .get(key);

      if (owner && owner.payment_id !== paymentId) {
        const conflict = new Error("already claimed");
        conflict.code = "CONFLICT";
        throw conflict;
      }

      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO tx_claims (tx_hash, payment_id, claimed_at) VALUES (?, ?, ?)",
      ).run(key, paymentId, now);
      db.prepare(
        "UPDATE payments SET status = 'CONFIRMED', tx_hash = ?, payer = ?, confirmed_at = ? WHERE id = ?",
      ).run(key, "0xworker", now, paymentId);
    });

    run();
    return { ok: true, code: null };
  } catch (error) {
    return { ok: false, code: String((error && error.code) || error) };
  } finally {
    db.close();
  }
}

parentPort.postMessage({ paymentId, ...attempt() });
