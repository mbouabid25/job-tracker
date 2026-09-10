import { createClient } from "@libsql/client";
import { jobKey, resolveStatus, isSameApplication } from "./normalize";

let _db = null;

function getDb() {
  if (_db) return _db;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (url && url.startsWith("libsql://")) {
    _db = createClient({ url, authToken });
  } else {
    // Local dev: use a file-based SQLite DB
    _db = createClient({ url: "file:data/jobs.db" });
  }
  return _db;
}

export async function initDb() {
  const db = getDb();
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      company TEXT NOT NULL,
      position TEXT NOT NULL,
      recruiter TEXT,
      status TEXT NOT NULL,
      last_updated TEXT,
      notes TEXT,
      job_key TEXT,
      source_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sync_log (
      user_id TEXT PRIMARY KEY,
      last_synced TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      account_email TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at INTEGER,
      scope TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_id, provider, account_email)
    );
    CREATE INDEX IF NOT EXISTS idx_mail_accounts_owner ON mail_accounts (owner_id);
    CREATE TABLE IF NOT EXISTS processed_emails (
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      processed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, message_id)
    );
  `);

  // ── migration: retire the exact company+position index in favour of a
  //    normalized key, so a rejection worded slightly differently still
  //    lands on the application it belongs to. ──
  try { await db.execute("DROP INDEX IF EXISTS idx_user_company_position"); } catch (_) {}
  try { await db.execute("ALTER TABLE jobs ADD COLUMN job_key TEXT"); } catch (_) {}
  try { await db.execute("ALTER TABLE jobs ADD COLUMN source_id TEXT"); } catch (_) {}
  const missing = await db.execute("SELECT id, company, position FROM jobs WHERE job_key IS NULL OR job_key = ''");
  for (const r of missing.rows) {
    await db.execute({
      sql: "UPDATE jobs SET job_key = ? WHERE id = ?",
      args: [jobKey(r.company, r.position), r.id],
    });
  }
  // ── consolidate rows that the old exact-match index let diverge.
  //    "Google / SWE Intern" and "Google Inc. / SWE, Intern 2026" were two
  //    separate applications; they are one, and its status is the furthest
  //    stage any of those emails reported. ──
  const dupes = await db.execute(
    "SELECT user_id, job_key FROM jobs WHERE job_key IS NOT NULL GROUP BY user_id, job_key HAVING COUNT(*) > 1"
  );
  for (const d of dupes.rows) {
    const rows = await db.execute({
      sql: "SELECT id, company, position, recruiter, status, last_updated, notes FROM jobs WHERE user_id = ? AND job_key = ? ORDER BY id",
      args: [d.user_id, d.job_key],
    });
    if (rows.rows.length < 2) continue;
    const survivor = rows.rows[0];
    let status = survivor.status;
    let lastUpdated = survivor.last_updated;
    let notes = survivor.notes;
    let recruiter = survivor.recruiter;
    for (const r of rows.rows.slice(1)) {
      status = resolveStatus(status, r.status, lastUpdated, r.last_updated);
      if (r.last_updated && (!lastUpdated || new Date(r.last_updated) > new Date(lastUpdated))) {
        lastUpdated = r.last_updated;
        notes = r.notes ?? notes;
      }
      recruiter = recruiter ?? r.recruiter;
    }
    await db.execute({
      sql: "UPDATE jobs SET status = ?, last_updated = ?, notes = ?, recruiter = ?, updated_at = datetime('now') WHERE id = ?",
      args: [status, lastUpdated, notes, recruiter, survivor.id],
    });
    await db.execute({
      sql: "DELETE FROM jobs WHERE user_id = ? AND job_key = ? AND id <> ?",
      args: [d.user_id, d.job_key, survivor.id],
    });
  }

  await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_job_key ON jobs (user_id, job_key)");
}

async function ensureInit() {
  await initDb();
}

export async function upsertJobs(userId, jobs) {
  await ensureInit();
  const db = getDb();
  const stats = { inserted: 0, updated: 0, skipped: 0 };

  for (const j of jobs) {
    if (!j.company || !j.position) { stats.skipped += 1; continue; }
    const key = jobKey(j.company, j.position);

    let existing = await db.execute({
      sql: "SELECT id, company, position, status, last_updated, recruiter, notes FROM jobs WHERE user_id = ? AND job_key = ?",
      args: [userId, key],
    });

    // Fallback: same role at a company whose name is written more or less
    // fully in another email ("Keystone" vs "Keystone Strategy").
    if (!existing.rows.length) {
      const candidates = await db.execute({
        sql: "SELECT id, company, position, status, last_updated, recruiter, notes FROM jobs WHERE user_id = ?",
        args: [userId],
      });
      const hit = candidates.rows.find((r) => isSameApplication(r.company, r.position, j.company, j.position));
      if (hit) existing = { rows: [hit] };
    }

    if (existing.rows.length) {
      const cur = existing.rows[0];
      const status = resolveStatus(cur.status, j.status, cur.last_updated, j.lastUpdated);
      // Only let a newer email rewrite the descriptive fields.
      const incomingNewer =
        !cur.last_updated || (j.lastUpdated && new Date(j.lastUpdated) >= new Date(cur.last_updated));
      await db.execute({
        sql: `UPDATE jobs SET
                status = ?,
                recruiter = COALESCE(?, recruiter),
                last_updated = CASE WHEN ? THEN ? ELSE last_updated END,
                notes = CASE WHEN ? THEN ? ELSE notes END,
                source_id = CASE WHEN ? THEN COALESCE(?, source_id) ELSE source_id END,
                updated_at = datetime('now')
              WHERE id = ?`,
        args: [
          status,
          j.recruiter ?? null,
          incomingNewer ? 1 : 0, j.lastUpdated ?? cur.last_updated,
          incomingNewer ? 1 : 0, j.notes ?? cur.notes,
          incomingNewer ? 1 : 0, (j.sourceIds && j.sourceIds[j.sourceIds.length - 1]) ?? null,
          cur.id,
        ],
      });
      stats.updated += 1;
    } else {
      await db.execute({
        sql: `INSERT INTO jobs (user_id, company, position, recruiter, status, last_updated, notes, job_key, source_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [userId, j.company, j.position, j.recruiter ?? null, j.status, j.lastUpdated ?? null, j.notes ?? null, key,
               (j.sourceIds && j.sourceIds[j.sourceIds.length - 1]) ?? null],
      });
      stats.inserted += 1;
    }
  }

  await db.execute({
    sql: `INSERT OR REPLACE INTO sync_log (user_id, last_synced) VALUES (?, datetime('now'))`,
    args: [userId],
  });
  return stats;
}


export async function getJobs(userId) {
  await ensureInit();
  const result = await getDb().execute({
    sql: "SELECT * FROM jobs WHERE user_id = ? ORDER BY last_updated DESC",
    args: [userId],
  });
  return result.rows;
}

export async function getLastSynced(userId) {
  await ensureInit();
  const result = await getDb().execute({
    sql: "SELECT last_synced FROM sync_log WHERE user_id = ?",
    args: [userId],
  });
  return result.rows[0]?.last_synced ?? null;
}

export async function deleteJob(userId, jobId) {
  await ensureInit();
  await getDb().execute({
    sql: "DELETE FROM jobs WHERE user_id = ? AND id = ?",
    args: [userId, jobId],
  });
}

export async function updateJobStatus(userId, jobId, status) {
  await ensureInit();
  await getDb().execute({
    sql: "UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE user_id = ? AND id = ?",
    args: [status, userId, jobId],
  });
}

export async function markSynced(userId) {
  await ensureInit();
  await getDb().execute({
    sql: "INSERT OR REPLACE INTO sync_log (user_id, last_synced) VALUES (?, datetime('now'))",
    args: [userId],
  });
}

export async function upsertMailAccount({ ownerId, provider, accountEmail, accessToken, refreshToken, expiresAt, scope }) {
  await ensureInit();
  await getDb().execute({
    sql: `INSERT INTO mail_accounts (owner_id, provider, account_email, access_token, refresh_token, expires_at, scope, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(owner_id, provider, account_email) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = COALESCE(excluded.refresh_token, mail_accounts.refresh_token),
            expires_at = excluded.expires_at,
            scope = excluded.scope,
            updated_at = datetime('now')`,
    args: [ownerId, provider, accountEmail, accessToken, refreshToken ?? null, expiresAt ?? null, scope ?? null],
  });
}

export async function listMailAccounts(ownerId) {
  await ensureInit();
  const result = await getDb().execute({
    sql: "SELECT * FROM mail_accounts WHERE owner_id = ? ORDER BY provider, account_email",
    args: [ownerId],
  });
  return result.rows;
}

export async function deleteMailAccount(ownerId, accountId) {
  await ensureInit();
  await getDb().execute({
    sql: "DELETE FROM mail_accounts WHERE owner_id = ? AND id = ?",
    args: [ownerId, accountId],
  });
}

export async function updateMailAccountTokens(accountId, { accessToken, refreshToken, expiresAt }) {
  await ensureInit();
  await getDb().execute({
    sql: `UPDATE mail_accounts
          SET access_token = COALESCE(?, access_token),
              refresh_token = COALESCE(?, refresh_token),
              expires_at = ?,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [accessToken ?? null, refreshToken ?? null, expiresAt ?? null, accountId],
  });
}

export async function filterUnseenEmails(userId, messageIds) {
  if (!messageIds.length) return new Set();
  await ensureInit();
  const placeholders = messageIds.map(() => "?").join(",");
  const result = await getDb().execute({
    sql: `SELECT message_id FROM processed_emails WHERE user_id = ? AND message_id IN (${placeholders})`,
    args: [userId, ...messageIds],
  });
  return new Set(result.rows.map((r) => r.message_id));
}

export async function markEmailsProcessed(userId, messageIds) {
  if (!messageIds.length) return;
  await ensureInit();
  const db = getDb();
  for (const id of messageIds) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO processed_emails (user_id, message_id) VALUES (?, ?)",
      args: [userId, id],
    });
  }
}
