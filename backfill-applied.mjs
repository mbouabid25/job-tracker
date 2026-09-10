// One-off: find when each already-tracked application was submitted, so the
// tracker can show time-to-response for rows created before applied_at existed.
// Gmail search only — no classifier calls. Dry run unless --write is passed.
//   BACKFILL_USER=you@example.com node backfill-applied.mjs [--write]
import pkg from '@next/env';
const { loadEnvConfig } = pkg; loadEnvConfig(process.cwd(), false);
const { createClient } = await import('@libsql/client');
const { google } = await import('googleapis');

const userId = process.env.BACKFILL_USER;
if (!userId) { console.error('Set BACKFILL_USER to the account email to backfill'); process.exit(1); }
const WRITE = process.argv.includes('--write');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

if (WRITE) {
  for (const col of ['applied_at', 'stage_at']) {
    try { await db.execute(`ALTER TABLE jobs ADD COLUMN ${col} TEXT`); } catch (_) {}
  }
  await db.execute("UPDATE jobs SET applied_at = last_updated WHERE applied_at IS NULL AND status = 'applied'");
  await db.execute("UPDATE jobs SET stage_at = last_updated WHERE stage_at IS NULL AND status <> 'applied'");
}

const acc = await db.execute("SELECT refresh_token FROM mail_accounts WHERE provider='google' LIMIT 1");
const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
auth.setCredentials({ refresh_token: acc.rows[0].refresh_token });
const gmail = google.gmail({ version: 'v1', auth });

const all = (await db.execute({ sql: "SELECT * FROM jobs WHERE user_id = ?", args: [userId] })).rows;
const perCompany = new Map();
for (const r of all) perCompany.set(r.company.toLowerCase(), (perCompany.get(r.company.toLowerCase()) || 0) + 1);
const todo = all.filter((r) => !r.applied_at && r.status !== 'applied' && !/^unknown/i.test(r.company));
console.log(`${todo.length} replies without an application date${WRITE ? '' : ' (dry run — pass --write to save)'}\n`);

const CONFIRM = [
  'thank you for applying', 'thanks for applying', 'application received', 'received your application',
  'application has been received', 'application was received', 'your application for', 'your application to',
  'application submitted', 'your application was sent', 'successfully applied', 'indeed application',
].map((p) => `"${p}"`).join(' OR ');

// Rejections often open with "Thank you for applying…", so an outcome email can
// match the confirmation search; it must never count as the application date.
const OUTCOME = /unfortunately|regret|not (be )?moving forward|move forward with other|other candidates|not selected|no longer (under )?consider|decided (not )?to|pursue other|will not be (proceeding|moving)|not a (good )?fit|been filled|not to proceed|unable to offer/i;

const searchName = (c) => c.replace(/["“”]/g, '').replace(/,?\s+(inc|llc|ltd|corp|corporation|co|plc|lp|llp)\.?$/i, '').trim();
const roleWords = (p) => String(p || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|for|with|20\d\d|summer|fall|intern)$/.test(w)).slice(0, 2);

async function appliedDate(r) {
  const stage = new Date(r.stage_at || r.last_updated);
  if (isNaN(stage)) return null;
  const before = Math.floor(stage.getTime() / 1000) + 86400;
  const after = before - 400 * 86400;
  const list = await gmail.users.messages.list({
    userId: 'me', maxResults: 25, q: `"${searchName(r.company)}" (${CONFIRM}) after:${after} before:${before}`,
  });
  const ids = (list.data.messages || []).map((m) => m.id);
  if (!ids.length) return null;
  const msgs = await Promise.all(ids.map((id) =>
    gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject'] }).then((m) => ({
      at: new Date(Number(m.data.internalDate)),
      subject: (m.data.payload?.headers?.find((h) => h.name === 'Subject')?.value || '').toLowerCase(),
      snippet: (m.data.snippet || '').toLowerCase(),
    }))));
  // skip outcome emails and the email that set the current stage itself
  const valid = msgs
    .filter((m) => m.at <= stage && Math.abs(stage - m.at) > 120000 && !OUTCOME.test(`${m.subject} ${m.snippet}`))
    .sort((a, b) => a.at - b.at);
  if (!valid.length) return null;
  // Prefer confirmations that name the role; with one application at the
  // company the earliest confirmation is it; with several, the one closest
  // before this reply is the likeliest match.
  const words = roleWords(r.position);
  const named = words.length ? valid.filter((m) => words.every((w) => m.subject.includes(w))) : [];
  if (named.length) return named[0].at;
  return (perCompany.get(r.company.toLowerCase()) || 0) > 1 ? valid[valid.length - 1].at : valid[0].at;
}

let found = 0;
const byStatus = {};
for (let i = 0; i < todo.length; i += 5) {
  const slice = todo.slice(i, i + 5);
  const dates = await Promise.all(slice.map((r) => appliedDate(r).catch(() => null)));
  for (let k = 0; k < slice.length; k++) {
    const r = slice[k], at = dates[k];
    const stage = new Date(r.stage_at || r.last_updated);
    if (!at) { console.log(`  —   ${r.company} / ${r.position} (${r.status}): no confirmation found`); continue; }
    found++;
    const days = Math.max(0, Math.round((stage - at) / 86400000));
    (byStatus[r.status] ||= []).push(days);
    console.log(`  ✓   ${r.company} / ${r.position} (${r.status}): applied ${at.toISOString().slice(0, 10)}, ${days}d to ${r.status} (stage ${stage.toISOString().slice(0, 16)})`);
    if (WRITE) await db.execute({ sql: "UPDATE jobs SET applied_at = ? WHERE id = ? AND applied_at IS NULL", args: [at.toISOString(), r.id] });
  }
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
console.log(`\nfound ${found}/${todo.length}${WRITE ? ' — saved' : ' — not saved (dry run)'}; same-day: ${Object.values(byStatus).flat().filter((d) => d === 0).length}`);
for (const [st, xs] of Object.entries(byStatus)) console.log(`  ${st}: n=${xs.length}, median ${med(xs)} days`);
process.exit(0);
