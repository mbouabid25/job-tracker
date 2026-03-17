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
