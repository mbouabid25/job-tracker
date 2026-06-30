import { createClient } from "@libsql/client";

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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_company_position
      ON jobs (user_id, company, position);
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
}

async function ensureInit() {
  await initDb();
}

export async function upsertJobs(userId, jobs) {
  await ensureInit();
  const db = getDb();
  for (const j of jobs) {
    if (!j.company || !j.position) continue; // skip incomplete classifications
    await db.execute({
      sql: `INSERT INTO jobs (user_id, company, position, recruiter, status, last_updated, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, company, position) DO UPDATE SET
              recruiter = excluded.recruiter,
              status = excluded.status,
              last_updated = excluded.last_updated,
              notes = excluded.notes,
              updated_at = datetime('now')`,
      args: [userId, j.company, j.position, j.recruiter ?? null, j.status, j.lastUpdated ?? null, j.notes ?? null],
    });
  }
  await db.execute({
    sql: `INSERT OR REPLACE INTO sync_log (user_id, last_synced) VALUES (?, datetime('now'))`,
    args: [userId],
  });
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
