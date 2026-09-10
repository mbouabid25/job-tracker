import pkg from '@next/env';
const { loadEnvConfig } = pkg; loadEnvConfig(process.cwd(), false);
const { createClient } = await import('@libsql/client');
const { google } = await import('googleapis');
const { getJobEmailDetails } = await import('./lib/gmail.js');
const { classifyApplications } = await import('./lib/classifier.js');
const { upsertJobs } = await import('./lib/db.js');

const userId = process.env.BACKFILL_USER; if (!userId) { console.error('Set BACKFILL_USER to the account email to backfill'); process.exit(1); }
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// Stage 1: only the queries that carry outcome signal.
const SIGNAL = [
  '"unfortunately" OR "regret to inform" OR "we regret" OR "not moving forward" OR "not be moving forward" OR "move forward with other" OR "other candidates" OR "not selected" OR "not be advancing" OR "no longer under consideration"',
  '"position has been filled" OR "role has been filled" OR "decided not to move" OR "pursue other candidates" OR "will not be proceeding" OR "keep your resume on file" OR "wish you the best" OR "best of luck in your" OR "not a fit at this time" OR "unable to offer" OR "unable to sponsor"',
  '"interview" OR "interviewing" OR "phone screen" OR "phone call" OR "video call" OR "hiring manager" OR "take-home" OR "technical assessment" OR "coding challenge" OR "case study" OR "final round" OR "next round" OR "superday"',
  '"schedule a time" OR "your availability" OR "availability for" OR "book a time" OR "calendar invite" OR "looking forward to speaking" OR "thanks for speaking" OR "great speaking with you" OR "enjoyed our conversation" OR "next steps"',
  '"job offer" OR "offer letter" OR "pleased to offer" OR "excited to offer" OR "excited to extend" OR "formal offer" OR "offer of employment" OR "congratulations"',
];

const acc = await db.execute("SELECT access_token, refresh_token FROM mail_accounts WHERE provider='google' LIMIT 1");
const o = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
o.setCredentials({ refresh_token: acc.rows[0].refresh_token });
const { credentials } = await o.refreshAccessToken(); o.setCredentials(credentials);
const accessToken = credentials.access_token;
const gmail = google.gmail({ version: 'v1', auth: o });

const since = Math.floor(Date.now()/1000) - 60*60*24*365;
const ids = new Set();
for (const q of SIGNAL) {
  let token, pages = 0;
  do {
    const r = await gmail.users.messages.list({ userId:'me', q:`${q} after:${since}`, maxResults:500, pageToken:token });
    (r.data.messages||[]).forEach(m => ids.add(m.id));
    token = r.data.nextPageToken; pages++;
  } while (token && pages < 20);
}
console.log('signal candidates:', ids.size);

const all = [...ids];
const ph = all.map(()=>'?').join(',');
const seen = new Set();
for (let i=0;i<all.length;i+=400) {
  const chunk = all.slice(i,i+400);
  const r = await db.execute({ sql:`SELECT message_id FROM processed_emails WHERE user_id=? AND message_id IN (${chunk.map(()=>'?').join(',')})`, args:[userId,...chunk]});
  r.rows.forEach(x=>seen.add(x.message_id));
}
const todo = all.filter(id => !seen.has(id));
console.log('already processed:', seen.size, '| to process now:', todo.length);

let done = 0, inserted = 0, updated = 0;
const CHUNK = 200;
for (let i = 0; i < todo.length; i += CHUNK) {
  const slice = todo.slice(i, i + CHUNK);
  const emails = await getJobEmailDetails(accessToken, slice);
  const classified = await classifyApplications(emails);
  if (classified.length) {
    const st = await upsertJobs(userId, classified);
    inserted += st.inserted; updated += st.updated;
  }
  // retire only what produced an application
  const acct = new Set();
  classified.forEach(c => (c.sourceIds||[]).forEach(id => acct.add(id)));
  const retire = emails.filter(e => acct.has(e.id)).map(e => e.id);
  for (const id of retire) {
    await db.execute({ sql:"INSERT OR IGNORE INTO processed_emails (user_id, message_id) VALUES (?,?)", args:[userId,id] });
  }
  done += slice.length;
  console.log(`  progress ${done}/${todo.length} — apps found so far: +${inserted} new, ${updated} updated`);
}
console.log(`\nDONE. inserted=${inserted} updated=${updated}`);
const s = await db.execute({sql:"SELECT status, COUNT(*) c FROM jobs WHERE user_id=? GROUP BY status ORDER BY c DESC", args:[userId]});
console.log("\nSTATUS BREAKDOWN NOW:");
s.rows.forEach(r=>console.log("  ", r.status, r.c));
process.exit(0);
