import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a job application tracker assistant. Analyze a list of emails and identify job applications.

Rules:
- Deduplicate by company + position (group all emails for the same application)
- Determine the CURRENT status from the most recent email in each thread
- Status options: "applied", "screening", "interview", "offer", "rejected", "withdrawn"
- Extract recruiter name and/or email if visible
- Only include emails clearly related to a specific job application

Return ONLY a raw JSON array with no markdown fences or explanation. Each element:
{
  "company": string,
  "position": string,
  "recruiter": string | null,
  "status": "applied" | "screening" | "interview" | "offer" | "rejected" | "withdrawn",
  "lastUpdated": ISO date string,
  "notes": string (one sentence describing current state)
}

If no job-related emails found, return: []`;

const BATCH_SIZE = 30;

async function classifyBatch(emails) {
  const payload = emails.map((e) => ({
    from: e.from,
    subject: e.subject,
    date: e.date,
    preview: e.body.slice(0, 400),
  }));

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
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

  const results = [];
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    const classified = await classifyBatch(batch);
    results.push(...classified);
  }
  return results;
}