// Shared identity normalization so the same application always maps to one row,
// even when the classifier words the company or title slightly differently
// across the application email, the recruiter reply, and the rejection.

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|plc|gmbh|sa|nv|ag|llp|lp|partners|technologies|technology|tech|labs|solutions|services|consulting|global|international|worldwide|usa|us)\b/g;

// Only strip tokens that never identify a role: cohort/season/year markers and
// work-arrangement words. Seniority and role nouns ("Sr.", "Associate",
// "Analyst") are meaningful and must survive — stripping them turned
// "Sr. Associate (Class of 2026)" into the meaningless "class of".
// Season+year pairs are cohort markers ("Data Analyst, Summer 2026").
// A bare season is part of the TITLE ("Summer Analyst") and must survive —
// merging "Summer Analyst" with "Full-Time Analyst" would erase a real role.
const COHORT_NOISE = /\b(summer|fall|autumn|spring|winter)\s+20\d\d\b/g;
const POSITION_NOISE = /\b(20\d\d|remote|hybrid|onsite|on[- ]?site|class of|cohort|start date)\b/g;

function base(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCompany(company) {
  let s = base(company);
  s = s.replace(COMPANY_SUFFIXES, " ").replace(/\s+/g, " ").trim();
  return s || base(company);
}

export function normalizePosition(position) {
  // Parentheticals are almost always cohort/location asides:
  // "Sr. Associate (Class of 2026)" -> "Sr. Associate"
  let raw = String(position || "").replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  let s = base(raw);
  s = s.replace(COHORT_NOISE, " ").replace(POSITION_NOISE, " ").replace(/\s+/g, " ").trim();
  // "sr" and "senior" are the same role level; likewise jr/junior.
  s = s.replace(/\bsr\b/g, "senior").replace(/\bjr\b/g, "junior");
  s = s.replace(/\s+/g, " ").trim();
  return s || base(position);
}

// The key an application is stored under. Position is deliberately coarse:
// a rejection that says "Data Analyst" should match an application that said
// "Data Analyst, Summer 2026 (Intern)".
export function jobKey(company, position) {
  return `${normalizeCompany(company)}::${normalizePosition(position)}`;
}

// Pipeline ordering. A later email should not silently demote an application
// that has already advanced, but terminal outcomes always win.
const RANK = { applied: 1, viewed: 2, screening: 3, assessment: 4, interview: 5, offer: 6 };
const TERMINAL = new Set(["rejected", "withdrawn"]);

export function resolveStatus(existing, incoming, existingDate, incomingDate) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (existing === incoming) return incoming;

  // A rejection or withdrawal is the end of the road, whenever it arrives.
  if (TERMINAL.has(incoming)) return incoming;

  // Never let a stale "applied" auto-ack overwrite a real rejection.
  if (TERMINAL.has(existing)) {
    const iDate = incomingDate ? new Date(incomingDate) : null;
    const eDate = existingDate ? new Date(existingDate) : null;
    // A rejection is final. Emails from the same stretch of the process
    // (interview threads, thank-you notes) frequently carry timestamps around
    // the rejection and must not silently reopen it. Only a genuinely later
    // re-engagement — a month or more on — counts as a new run at the role.
    const REOPEN_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
    if (iDate && eDate && iDate - eDate > REOPEN_AFTER_MS) return incoming;
    return existing;
  }

  // Otherwise take the furthest point reached in the pipeline.
  return (RANK[incoming] || 0) > (RANK[existing] || 0) ? incoming : existing;
}

// Exact keys cannot catch every brand-name variation ("Keystone" vs
// "Keystone Strategy"). This is a deliberately conservative fallback: two
// applications are the same only when the role matches exactly AND one
// company's word list is a strict prefix of the other's. That merges
// "Keystone" / "Keystone Strategy" while keeping "Boston Consulting" and
// "Boston Scientific" apart, since those diverge at the second word.
export function isSameApplication(companyA, positionA, companyB, positionB) {
  if (normalizePosition(positionA) !== normalizePosition(positionB)) return false;
  // Compare the *unstripped* words: removing "consulting" from
  // "Boston Consulting" would leave a bare "boston" that wrongly prefixes
  // "Boston Scientific". Only legal-entity noise is dropped here.
  const legal = /^(inc|llc|ltd|limited|corp|corporation|co|plc|gmbh|llp|lp|sa|nv|ag)$/;
  const toks = (c) => base(c).split(" ").filter((t) => t && !legal.test(t));
  const a = toks(companyA);
  const b = toks(companyB);
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((tok, i) => tok === long[i]);
}
