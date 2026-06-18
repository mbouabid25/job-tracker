import path from "path";
import fs from "fs";

let _db = null;

function getDb() {
  if (_db) return _db;
  const Database = require("better-sqlite3");
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  _db = new Database(path.join(dir, "jobs.db"));
  _db.exec(`
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
  return _db;
}

export function upsertJobs(userId, jobs) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO jobs (user_id, company, position, recruiter, status, last_updated, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, company, position) DO UPDATE SET
      recruiter = excluded.recruiter,
      status = excluded.status,
      last_updated = excluded.last_updated,
      notes = excluded.notes,
      updated_at = datetime('now')
  `);
  const run = db.transaction((jobs) => {
    for (const j of jobs) {
      stmt.run(userId, j.company, j.position, j.recruiter ?? null, j.status, j.lastUpdated ?? null, j.notes ?? null);
    }
  });
  run(jobs);
  db.prepare(`INSERT OR REPLACE INTO sync_log (user_id, last_synced) VALUES (?, datetime('now'))`).run(userId);
}

export function getJobs(userId) {
  return getDb()
    .prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY last_updated DESC NULLS LAST")
    .all(userId);
}

export function getLastSynced(userId) {
  const row = getDb().prepare("SELECT last_synced FROM sync_log WHERE user_id = ?").get(userId);
  return row?.last_synced ?? null;
}

export function deleteJob(userId, jobId) {
  getDb().prepare("DELETE FROM jobs WHERE user_id = ? AND id = ?").run(userId, jobId);
}

export function updateJobStatus(userId, jobId, status) {
  getDb()
    .prepare("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE user_id = ? AND id = ?")
    .run(status, userId, jobId);
}

export function markSynced(userId) {
  getDb()
    .prepare("INSERT OR REPLACE INTO sync_log (user_id, last_synced) VALUES (?, datetime('now'))")
    .run(userId);
}

export function upsertMailAccount({ ownerId, provider, accountEmail, accessToken, refreshToken, expiresAt, scope }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO mail_accounts (owner_id, provider, account_email, access_token, refresh_token, expires_at, scope, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(owner_id, provider, account_email) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, mail_accounts.refresh_token),
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      updated_at = datetime('now')
  `);
  stmt.run(ownerId, provider, accountEmail, accessToken, refreshToken ?? null, expiresAt ?? null, scope ?? null);
}

export function listMailAccounts(ownerId) {
  return getDb()
    .prepare("SELECT * FROM mail_accounts WHERE owner_id = ? ORDER BY provider, account_email")
    .all(ownerId);
}

export function deleteMailAccount(ownerId, accountId) {
  getDb().prepare("DELETE FROM mail_accounts WHERE owner_id = ? AND id = ?").run(ownerId, accountId);
}

export function filterUnseenEmails(userId, messageIds) {
  if (!messageIds.length) return new Set();
  const db = getDb();
  const placeholders = messageIds.map(() => "?").join(",");
  const seen = db
    .prepare(`SELECT message_id FROM processed_emails WHERE user_id = ? AND message_id IN (${placeholders})`)
    .all(userId, ...messageIds)
    .map((r) => r.message_id);
  return new Set(seen);
}

export function markEmailsProcessed(userId, messageIds) {
  if (!messageIds.length) return;
  const db = getDb();
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO processed_emails (user_id, message_id) VALUES (?, ?)"
  );
  const run = db.transaction((ids) => {
    for (const id of ids) stmt.run(userId, id);
  });
  run(messageIds);
}

export function updateMailAccountTokens(accountId, { accessToken, refreshToken, expiresAt }) {
  getDb()
    .prepare(`
      UPDATE mail_accounts
      SET access_token = COALESCE(?, access_token),
          refresh_token = COALESCE(?, refresh_token),
          expires_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `)
    .run(accessToken ?? null, refreshToken ?? null, expiresAt ?? null, accountId);
}
