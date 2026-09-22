import { google } from "googleapis";

const JOB_QUERIES = [
  // ── automated: ATS platforms and job boards ──
  "from:(greenhouse.io OR lever.co OR workday.com OR myworkdayjobs.com OR ashbyhq.com OR icims.com OR taleo.net OR smartrecruiters.com OR jobvite.com OR breezy.hr OR recruitee.com OR workable.com OR bamboohr.com OR successfactors.com OR oraclecloud.com OR paylocity.com OR adp.com OR ultipro.com OR dayforcehcm.com OR eightfold.ai OR phenompeople.com OR avature.net OR gr8people.com)",
  "from:(linkedin.com OR indeed.com OR glassdoor.com OR ziprecruiter.com OR dice.com OR monster.com OR wellfound.com OR angel.co OR handshake.com OR joinhandshake.com OR simplify.jobs OR jobright.ai OR builtin.com OR otta.com OR hired.com OR triplebyte.com)",

  // ── application acknowledgements ──
  '"thank you for applying" OR "thanks for applying" OR "we received your application" OR "application received" OR "application submitted" OR "your application has been received" OR "successfully submitted" OR "we have received your"',
  '"applied to" OR "your application to" OR "application for the position" OR "application confirmation"',

  // ── rejections: the phrasings that actually appear ──
  '"unfortunately" OR "regret to inform" OR "we regret" OR "not moving forward" OR "not be moving forward" OR "move forward with other" OR "other candidates" OR "not selected" OR "not be advancing" OR "no longer under consideration"',
  '"position has been filled" OR "role has been filled" OR "decided not to move" OR "pursue other candidates" OR "will not be proceeding" OR "keep your resume on file" OR "wish you the best" OR "best of luck in your" OR "not a fit at this time" OR "unable to offer" OR "unable to sponsor"',

  // ── live recruiting conversations: interviews, screens, scheduling ──
  '"interview" OR "interviewing" OR "phone screen" OR "phone call" OR "video call" OR "hiring manager" OR "take-home" OR "technical assessment" OR "coding challenge" OR "case study" OR "final round" OR "next round" OR "superday"',
  '"schedule a time" OR "your availability" OR "availability for" OR "book a time" OR "calendar invite" OR "looking forward to speaking" OR "thanks for speaking" OR "great speaking with you" OR "enjoyed our conversation" OR "next steps"',
  '"coffee chat" OR "informational" OR "connect with you" OR "introduce you" OR "chat about the role" OR "learn more about the role" OR "your candidacy" OR "your application for" OR "recruiting team" OR "talent team"',

  // ── offers ──
  '"job offer" OR "offer letter" OR "pleased to offer" OR "excited to offer" OR "excited to extend" OR "formal offer" OR "offer of employment" OR "congratulations"',

  // ── status updates ──
  '"application status" OR "update on your application" OR "status of your application" OR "following up on your application" OR "regarding your application"',

  // ── recruiting-team senders at any company domain ──
  // Recruiting-team senders. Deliberately excludes bare noreply/no-reply:
  // that matched ~8.5k messages, i.e. every automated email in the mailbox,
  // which is cost and noise rather than signal.
  "from:(recruiting OR recruiter OR recruitment OR talent OR careers OR hiring) -from:(newsletter OR digest OR marketing OR promotions OR billing OR receipt OR invoice)",
];

function decodeBase64(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function getBody(payload) {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64(payload.body.data).slice(0, 2500);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64(part.body.data).slice(0, 2500);
      }
    }
    for (const part of payload.parts) {
      const body = getBody(part);
      if (body) return body;
    }
  }
  return "";
}

// Lists candidate message IDs only (cheap, no body/detail fetch) so callers can
// filter out already-processed messages before paying for detail fetches.
export async function listJobMessageIds(accessToken, sinceDate) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth });

  // Look-back window. Defaults to a full year — six months silently hid the
  // earlier half of a long search. Override with JOB_LOOKBACK_DAYS.
  // Routine syncs only need recent mail: enumerating a year of candidate ids on
  // every 30-minute refresh is thousands of wasted API calls. Backfills pass
  // JOB_LOOKBACK_DAYS (or a sinceDate) to sweep the full history.
  const lookbackDays = Number(process.env.JOB_LOOKBACK_DAYS || 180);
  const since = sinceDate
    ? Math.floor(new Date(sinceDate.endsWith("Z") ? sinceDate : sinceDate + "Z").getTime() / 1000)
    : Math.floor(Date.now() / 1000) - 60 * 60 * 24 * lookbackDays;

  const seenIds = new Set();
  const allIds = [];

  // Gmail returns at most 500 ids per page. Without following nextPageToken
  // every query was silently truncated at its first page, which capped the
  // whole tracker at a few hundred emails no matter how many existed.
  const MAX_PAGES_PER_QUERY = Number(process.env.JOB_MAX_PAGES || 20);
  const MAX_TOTAL_IDS = Number(process.env.JOB_MAX_IDS || 20000);

  for (const q of JOB_QUERIES) {
    let pageToken;
    let pages = 0;
    try {
      do {
        const res = await gmail.users.messages.list({
          userId: "me",
          q: `${q} after:${since}`,
          maxResults: 500,
          pageToken,
        });
        for (const m of res.data.messages || []) {
          if (!seenIds.has(m.id)) {
            seenIds.add(m.id);
            allIds.push(m.id);
          }
        }
        pageToken = res.data.nextPageToken;
        pages += 1;
      } while (pageToken && pages < MAX_PAGES_PER_QUERY && allIds.length < MAX_TOTAL_IDS);
    } catch (e) {
      console.error("gmail query failed:", q.slice(0, 60), e?.message);
    }
    if (allIds.length >= MAX_TOTAL_IDS) break;
  }

  return allIds;
}

// Fetches metadata details for a specific set of message IDs, in chunks.
export async function getJobEmailDetails(accessToken, messageIds) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth });

  const CHUNK = 50;
  const candidates = messageIds;
  const emails = [];
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          const detail = await gmail.users.messages.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });
          const headers = detail.data.payload?.headers || [];
          const get = (name) =>
            headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
          return {
            id,
            from: get("From"),
            subject: get("Subject"),
            date: get("Date"),
            body: detail.data.snippet || "",
          };
        } catch (_) {
          return null;
        }
      })
    );
    emails.push(...results.filter(Boolean));
  }

  return emails;
}
