import { google } from "googleapis";

const JOB_QUERIES = [
  // LinkedIn applications
  "from:jobs-noreply@linkedin.com",
  "from:jobalerts-noreply@linkedin.com",
  "from:(linkedin.com) subject:(applied OR application OR you applied)",
  "subject:(your application to) from:(linkedin)",

  // ATS platforms (where most companies process applications)
  "from:(greenhouse.io OR lever.co OR workday.com OR ashbyhq.com OR myworkdayjobs.com OR icims.com OR taleo.net OR smartrecruiters.com OR jobvite.com OR breezy.hr OR recruitee.com)",

  // Job boards
  "from:(indeed.com OR glassdoor.com OR ziprecruiter.com OR dice.com OR monster.com OR wellfound.com OR angel.co)",

  // Application confirmations
  "subject:(application received OR application submitted OR thank you for applying OR thanks for applying OR we received your application OR successfully applied OR you have applied)",

  // Recruiter outreach
  "subject:(opportunity OR open role OR open position OR job opportunity OR exciting opportunity) (recruiter OR recruiting OR talent OR hiring)",

  // Interview related
  "subject:(interview OR phone screen OR phone call OR video call OR hiring manager OR take-home OR technical assessment OR coding challenge)",

  // Offers and rejections
  "subject:(job offer OR offer letter OR pleased to offer OR congratulations)",
  "subject:(unfortunately OR not moving forward OR other candidates OR not selected OR position has been filled OR not a fit)",

  // Follow-ups
  "subject:(application status OR update on your application OR following up OR next steps)",
];

function decodeBase64(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function getBody(payload) {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64(payload.body.data).slice(0, 800);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64(part.body.data).slice(0, 800);
      }
    }
    for (const part of payload.parts) {
      const body = getBody(part);
      if (body) return body;
    }
  }
  return "";
}

export async function getJobEmails(accessToken, sinceDate) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: "v1", auth });

  const since = sinceDate
    ? Math.floor(new Date(sinceDate.endsWith("Z") ? sinceDate : sinceDate + "Z").getTime() / 1000)
    : Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 60;
  const seenIds = new Set();
  const allMessages = [];

  for (const q of JOB_QUERIES) {
    try {
      const res = await gmail.users.messages.list({
        userId: "me",
        q: `${q} after:${since}`,
        maxResults: 100,
      });
      for (const m of res.data.messages || []) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          allMessages.push(m);
        }
      }
    } catch (_) {}
  }

  const emails = await Promise.all(
    allMessages.slice(0, 100).map(async (msg) => {
      try {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "full",
        });
        const headers = detail.data.payload?.headers || [];
        const get = (name) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
        return {
          id: msg.id,
          from: get("From"),
          subject: get("Subject"),
          date: get("Date"),
          body: getBody(detail.data.payload) || detail.data.snippet || "",
        };
      } catch (_) {
        return null;
      }
    })
  );

  return emails.filter(Boolean);
}
