process.env.JOB_LOOKBACK_DAYS = '365';
import pkg from '@next/env'; const { loadEnvConfig } = pkg; loadEnvConfig(process.cwd(), false);
const { createClient } = await import('@libsql/client');
const { google } = await import('googleapis');
const { getJobEmailDetails } = await import('./lib/gmail.js');
const { classifyApplications } = await import('./lib/classifier.js');
const { upsertJobs } = await import('./lib/db.js');
const { jobKey } = await import('./lib/normalize.js');

const userId = 'bouab22m@mtholyoke.edu';
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// 1. remove the three fragmented Keystone rows so they rebuild under one key
const before = await db.execute("SELECT id, company, position, status FROM jobs WHERE lower(company) LIKE '%keystone%'");
console.log('existing keystone rows:', before.rows.length);
await db.execute("DELETE FROM jobs WHERE user_id = ? AND lower(company) LIKE '%keystone%'", );
await db.execute({ sql: "DELETE FROM jobs WHERE user_id = ? AND lower(company) LIKE '%keystone%'", args: [userId] });

// 2. un-process every keystone email so they re-classify with the fixed prompt
const acc = await db.execute("SELECT refresh_token FROM mail_accounts WHERE provider='google' LIMIT 1");
const o = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
o.setCredentials({ refresh_token: acc.rows[0].refresh_token });
const { credentials } = await o.refreshAccessToken(); o.setCredentials(credentials);
const gmail = google.gmail({ version:'v1', auth:o });
const r = await gmail.users.messages.list({ userId:'me', q:'keystone', maxResults:40 });
const ids = (r.data.messages||[]).map(m=>m.id);
console.log('keystone emails:', ids.length);
await db.execute({ sql:`DELETE FROM processed_emails WHERE user_id=? AND message_id IN (${ids.map(()=>'?').join(',')})`, args:[userId,...ids] });

// 3. reclassify them together so the rejection is seen alongside the interview thread
const emails = await getJobEmailDetails(credentials.access_token, ids);
console.log('fetched bodies:', emails.length);
const classified = await classifyApplications(emails);
console.log('\nclassified:');
classified.forEach(c => console.log(`   ${c.company} | ${c.position} | ${c.status} | ${c.recruiter||'-'}\n      key=${jobKey(c.company,c.position)}\n      ${String(c.notes||'').slice(0,120)}`));
const st = await upsertJobs(userId, classified);
console.log('\nwrote:', JSON.stringify(st));
const after = await db.execute("SELECT company, position, status, recruiter FROM jobs WHERE lower(company) LIKE '%keystone%'");
console.log('\nKEYSTONE NOW:');
after.rows.forEach(x=>console.log(`   ${x.company} / ${x.position} = ${x.status} (${x.recruiter||'-'})`));
process.exit(0);
