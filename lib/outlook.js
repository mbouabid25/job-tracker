const JOB_SEARCHES = [
  "application received",
  "thank you for applying",
  "applied to",
  "application submitted",
  "job application",
  "phone interview",
  "video interview",
  "technical assessment",
  "job offer",
  "not moving forward",
  "opportunity",
  "recruiter",
  "next steps"
];

function stripHtml(html = "") {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/?p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export async function getOutlookJobEmails(accessToken, sinceDate) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    ConsistencyLevel: "eventual",
  };

  // MS Graph does not allow combining $search and $filter in the same request.
  // We apply the date cutoff in-process after fetching.
  const sinceMs = sinceDate
    ? new Date(sinceDate.endsWith("Z") ? sinceDate : sinceDate + "Z").getTime()
    : Date.now() - 60 * 24 * 60 * 60 * 1000;

  const seen = new Set();
  const messageIds = [];

  for (const term of JOB_SEARCHES) {
    try {
      const params = new URLSearchParams({
        $search: `"${term}"`,
        $top: "25",
        $select: "id,subject,from,bodyPreview,receivedDateTime",
        $orderby: "receivedDateTime desc",
      });
      const res = await fetch(`https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`, { headers });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.value)) continue;
      for (const msg of data.value) {
        if (!seen.has(msg.id) && new Date(msg.receivedDateTime).getTime() >= sinceMs) {
          seen.add(msg.id);
          messageIds.push(msg.id);
        }
      }
    } catch (_) {}
  }

  const trimmed = messageIds.slice(0, 150);
  const details = await Promise.all(
    trimmed.map(async (id) => {
      try {
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${id}?$select=id,subject,from,receivedDateTime,body,bodyPreview`,
          { headers }
        );
        const data = await res.json();
        if (!res.ok) return null;
        const from = data.from?.emailAddress?.address || "";
        const body = data.body?.contentType === "html" ? stripHtml(data.body.content || "") : data.body?.content || data.bodyPreview || "";
        return {
          id: data.id,
          from,
          subject: data.subject || "",
          date: data.receivedDateTime,
          body: (body || data.bodyPreview || "").slice(0, 800),
        };
      } catch (_) {
        return null;
      }
    })
  );

  return details.filter(Boolean);
}
