import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a job application tracker. You read a person's email and reconstruct the state of every job application it reveals.

WHAT COUNTS AS A JOB APPLICATION EMAIL
Include BOTH of these categories — the second is easy to miss and matters most:
1. Automated mail: ATS confirmations, "application received", rejections, job-board notifications.
2. REAL HUMAN CONVERSATIONS with recruiters, hiring managers, or employees at a company where
   the person is a candidate. These often have informal subjects and no job title anywhere:
     - "Confirming your interview with <Company>", "Interviewing at <Company>"
     - "Marwa <> Robert Coffee Chat", "Connecting you for a chat"
     - "Thanks for speaking with us", "RE: Thank you <Name>!", "Great connecting"
     - scheduling, availability, calendar coordination, take-home assignments
   If a person at a company is coordinating a conversation about a role, that IS an application
   in progress. Infer the company from the sender's email domain when it is not written out.

STATUS — the CURRENT state of the application, not the best moment it ever had.

CRITICAL: if ANY email in the thread says the person was turned down, the status is
"rejected" — no matter how far the process got. An interview thread followed by a
"thanks for speaking with us / we are moving forward with other candidates" note is
REJECTED, not "interview". Rejection and withdrawal always override earlier progress.
Only when there is no such email do you report the furthest stage reached:
- "applied"    : application submitted / acknowledged, no human contact yet
- "viewed"     : PASSIVE activity only — LinkedIn "your application was viewed", "your
                 resume was downloaded", "a recruiter viewed your profile", applicant-portal
                 status changes. Nobody has contacted the person. This is NOT screening.
- "screening"  : an actual human made contact — recruiter outreach, intro call, coffee chat,
                 HR screen, or a request for availability. A person is engaging, not a system.
- "assessment" : a take-home, coding challenge, online assessment (OA), case study, or
                 timed test has been SENT or completed — but no live interview yet.
                 These are screening filters, not conversations, and are tracked separately.
- "interview"  : a live conversation with people — phone screen, video call, onsite,
                 superday, final round — scheduled, confirmed, or completed
- "offer"      : an offer is extended
- "rejected"   : declined at any stage — "moving forward with other candidates", "not selected",
                 "regret to inform", "unable to sponsor", "position filled"
- "withdrawn"  : the candidate withdrew

BE DECISIVE ABOUT REJECTIONS. Rejection language is often buried politely mid-email, after
pleasantries. If the message says the person is not continuing, the status is "rejected".

COMPANY AND POSITION
- company: the employer's real name, consistently written. Prefer the clean brand name
  ("Keystone", not "Keystone Strategy LLC" or "noreply@keystone.com"). Derive it from the
  sender domain if needed. NEVER null.
- position: the role title if stated anywhere in the thread. If a genuine recruiting
  conversation gives no title, use "Unknown Position" — do NOT drop the application.
  Keep the title stable across emails for the same role.
- recruiter: the human's name if a real person is corresponding. Use their name, not an
  address like "noreply@". null only when there is genuinely no human involved.

EXCLUDE: newsletters, job alerts for roles not applied to, marketing, generic career-fair
blasts, and mail the person sent that is unrelated to their own candidacy.

Group all emails for the same company+role into ONE entry reflecting the most advanced state.

Return ONLY a raw JSON array, no markdown fences, no commentary. Each element:
{
  "company": string (required, never null),
  "position": string (required, never null),
  "recruiter": string | null,
  "status": "applied" | "viewed" | "screening" | "assessment" | "interview" | "offer" | "rejected" | "withdrawn",
  "lastUpdated": ISO date string of the most recent email for this application,
  "appliedAt": ISO date of the email confirming the application was submitted (the earliest one in this group), or null if none of these emails shows when they applied,
  "stageAt": ISO date of the email that put the application in its current status (e.g. the rejection or the interview invite), or null,
  "notes": string (one sentence on the current state, including the reason if rejected),
  "sourceIds": string[] (the "id" of EVERY email you used for this application — required, never empty)
}

If genuinely no job-related emails are present, return: []`;

const BATCH_SIZE = 20;

async function classifyBatch(emails) {
  const payload = emails.map((e, idx) => ({
    id: e.id ?? `i${idx}`,
    from: e.from,
    subject: e.subject,
    date: e.date,
    preview: e.body.slice(0, 1200),
  }));

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 6000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Analyze these ${emails.length} emails and extract all job applications:\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text || "";
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return [];

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
}

export async function classifyApplications(emails) {
  if (!emails.length) return [];

  const batches = [];
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    batches.push(emails.slice(i, i + BATCH_SIZE));
  }

  // Run a few batches at a time: sequential is far too slow once MAX_PER_SYNC
  // is raised, and one failed batch must not lose the whole sync.
  const CONCURRENCY = 8;
  const results = [];
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const slice = batches.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map((b) => classifyBatch(b)));
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(...r.value);
      else console.error("classify batch failed:", r.reason?.message || r.reason);
    }
  }
  return results;
}
