"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { signOut } from "next-auth/react";

const REFRESH_MS = 3 * 60 * 1000; // auto-refresh every 3 min so new applications appear quickly
const PAGE_SIZE = 20;

const STATUS = {
  applied:   { label: "Applied",    color: "purple" },
  viewed:    { label: "Viewed",     color: "gray" },
  screening: { label: "Screening",  color: "amber" },
  assessment:{ label: "Assessment", color: "green" },
  interview: { label: "Interview",  color: "blue" },
  offer:     { label: "Offer",      color: "teal" },
  rejected:  { label: "Rejected",   color: "red" },
  withdrawn: { label: "Withdrawn",  color: "gray" },
};

const FILTERS = ["all", "applied", "viewed", "screening", "assessment", "interview", "offer", "rejected"];

function Badge({ status, onClick, editable }) {
  const s = STATUS[status] || { label: status, color: "gray" };
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 500,
        cursor: editable ? "pointer" : "default",
        background: `var(--${s.color}-bg)`,
        color: `var(--${s.color}-text)`,
        userSelect: "none",
        border: editable ? `1px dashed var(--${s.color}-text)` : "none",
        opacity: editable ? 0.85 : 1,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--${s.color}-text)`, flexShrink: 0 }} />
      {s.label}
      {editable && <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>}
    </span>
  );
}

function StatusDropdown({ jobId, current, onUpdate, onClose }) {
  return (
    <div style={{
      position: "absolute",
      top: "100%",
      left: 0,
      zIndex: 50,
      background: "var(--surface)",
      border: "1px solid var(--border-md)",
      borderRadius: 10,
      boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
      padding: "4px",
      minWidth: 140,
      marginTop: 4,
    }}>
      {Object.entries(STATUS).map(([key, val]) => (
        <button
          key={key}
          onClick={() => { onUpdate(jobId, key); onClose(); }}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            background: key === current ? "var(--surface2)" : "transparent",
            border: "none",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 13,
            color: "var(--text)",
            fontWeight: key === current ? 500 : 400,
          }}
        >
          {val.label}
        </button>
      ))}
    </div>
  );
}

function formatDate(str) {
  if (!str) return "—";
  try {
    return new Date(str).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return str; }
}

function formatCountdown(ms) {
  if (ms <= 0) return "refreshing...";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const DAY_MS = 86400000;

function daysBetween(from, to) {
  const a = new Date(from), b = new Date(to);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

const STAGE_VERB = {
  viewed: "Viewed", screening: "Screen call", assessment: "Assessment",
  interview: "Interview", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn",
};

// Days from applying to the current stage — or, still at "applied", days spent waiting.
function elapsed(job) {
  if (!job.applied_at) return null;
  if (job.status === "applied") {
    const d = daysBetween(job.applied_at, new Date());
    return d == null ? null : { days: d, waiting: true };
  }
  const d = daysBetween(job.applied_at, job.stage_at || job.last_updated);
  return d == null ? null : { days: d, waiting: false };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export default function JobTracker({ session }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showInsights, setShowInsights] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [sort, setSort] = useState("recent"); // "recent" | "oldest" | "company" | "status"
  const nextRefreshAt = useRef(null);

  const load = useCallback(async (force = false) => {
    if (force) setSyncing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs${force ? "?refresh=true" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch");
      setJobs(data.jobs || []);
      setLastSynced(data.lastSynced);
      nextRefreshAt.current = Date.now() + REFRESH_MS;
      setCountdown(REFRESH_MS);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      const data = await res.json();
      if (res.ok) {
        setAccounts(data.accounts || []);
      }
    } catch (_) {
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadAccounts();
    const interval = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(interval);
  }, [load, loadAccounts]);

  useEffect(() => {
    if (!nextRefreshAt.current) return;
    const tick = setInterval(() => {
      setCountdown(Math.max(0, nextRefreshAt.current - Date.now()));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastSynced]);

  useEffect(() => {
    const handler = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "account-linked") {
        loadAccounts();
        load(true);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [load, loadAccounts]);

  // Reset pagination when data/filter changes
  useEffect(() => {
    setPage(1);
  }, [filter, jobs.length]);

  const updateStatus = async (jobId, status) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId
      ? { ...j, status, stage_at: j.status !== status ? new Date().toISOString() : j.stage_at }
      : j)));
    await fetch("/api/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: jobId, status }),
    });
  };

  const deleteJob = async (jobId) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    await fetch("/api/jobs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: jobId }),
    });
  };

  const connectProvider = (provider) => {
    const w = 520;
    const h = 640;
    const y = window.top.outerHeight / 2 + window.top.screenY - h / 2;
    const x = window.top.outerWidth / 2 + window.top.screenX - w / 2;
    window.open(`/api/oauth/${provider}/start`, `${provider}-oauth`, `width=${w},height=${h},left=${x},top=${y}`);
  };

  const removeAccount = async (id) => {
    await fetch("/api/accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    load(true);
  };

  const q = search.trim().toLowerCase();
  const searched = q
    ? jobs.filter((j) =>
        [j.company, j.position, j.recruiter, j.notes]
          .some((v) => String(v || "").toLowerCase().includes(q))
      )
    : jobs;
  const filtered = filter === "all" ? searched : searched.filter((j) => j.status === filter);

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "recent") {
      const da = new Date(a.applied_at || a.last_updated || 0);
      const db = new Date(b.applied_at || b.last_updated || 0);
      return db - da;
    }
    if (sort === "oldest") {
      const da = new Date(a.applied_at || a.last_updated || 0);
      const db = new Date(b.applied_at || b.last_updated || 0);
      return da - db;
    }
    if (sort === "company") {
      return (a.company || "").localeCompare(b.company || "");
    }
    if (sort === "status") {
      const order = ["offer", "interview", "assessment", "screening", "viewed", "applied", "rejected", "withdrawn"];
      return order.indexOf(a.status) - order.indexOf(b.status);
    }
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const stats = {
    total: jobs.length,
    active: jobs.filter((j) => ["applied", "viewed", "screening", "assessment", "interview"].includes(j.status)).length,
    offers: jobs.filter((j) => j.status === "offer").length,
    rejected: jobs.filter((j) => j.status === "rejected").length,
  };

  const insights = useMemo(() => {
    if (!jobs.length) return null;
    const total = jobs.length;
    const by = (s) => jobs.filter((j) => j.status === s).length;
    const viewed = by("viewed"), screening = by("screening"), assessment = by("assessment"), interview = by("interview"), offer = by("offer"), rejected = by("rejected");
    const positive = screening + assessment + interview + offer;   // moved forward at least one stage
    const responded = positive + rejected;            // any human reply, good or bad
    const awaiting = total - responded;
    const pct = (n) => total ? Math.round((n / total) * 1000) / 10 : 0;

    // ── monthly volume from the email date ──
    const monthMap = new Map();
    const dowCount = [0, 0, 0, 0, 0, 0, 0];
    const dayMap = new Map();
    for (const j of jobs) {
      const raw = j.applied_at || j.last_updated;
      if (!raw) continue;
      const d = new Date(raw);
      if (isNaN(d)) continue;
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthMap.set(ym, (monthMap.get(ym) || 0) + 1);
      dowCount[d.getDay()] += 1;
      const dk = d.toISOString().slice(0, 10);
      dayMap.set(dk, (dayMap.get(dk) || 0) + 1);
    }
    const months = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const peakMonth = months.reduce((a, b) => (b[1] > a[1] ? b : a), months[0] || ["", 0]);
    const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const peakDowIdx = dowCount.indexOf(Math.max(...dowCount));
    const peakDay = [...dayMap.entries()].sort((a, b) => b[1] - a[1])[0] || ["", 0];

    // ── companies applied to more than once ──
    const compMap = new Map();
    for (const j of jobs) {
      const c = (j.company || "").trim();
      if (!c || c.toLowerCase() === "unknown company") continue;
      compMap.set(c, (compMap.get(c) || 0) + 1);
    }
    const topCompanies = [...compMap.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // ── pace ──
    const dates = jobs.map((j) => new Date(j.applied_at || j.last_updated)).filter((d) => !isNaN(d)).sort((a, b) => a - b);
    const spanDays = dates.length > 1 ? Math.max(1, (dates[dates.length - 1] - dates[0]) / 86400000) : 1;
    const perWeek = Math.round((total / spanDays) * 7 * 10) / 10;

    // ── response times: application date -> the email that set the current stage ──
    const RESP = ["screening", "assessment", "interview", "offer", "rejected"];
    const timed = jobs.map((j) => ({ j, e: elapsed(j) })).filter((x) => x.e && !x.e.waiting && RESP.includes(x.j.status));
    const responseTimes = RESP.map((st) => {
      const xs = timed.filter((x) => x.j.status === st).sort((a, b) => a.e.days - b.e.days);
      if (!xs.length) return null;
      return { status: st, n: xs.length, median: median(xs.map((x) => x.e.days)), fastest: xs[0], slowest: xs[xs.length - 1] };
    }).filter(Boolean);
    const respondedRows = jobs.filter((j) => RESP.includes(j.status)).length;
    const ghosted = jobs.map(elapsed).filter((e) => e && e.waiting && e.days >= 30).length;

    return {
      total, viewed, screening, assessment, interview, offer, rejected, positive, responded, awaiting, pct,
      months, peakMonth, peakDay, peakDow: DOW[peakDowIdx], peakDowCount: dowCount[peakDowIdx],
      topCompanies, perWeek,
      responseTimes, timedCount: timed.length, respondedRows, ghosted,
      firstDate: dates[0], lastDate: dates[dates.length - 1],
    };
  }, [jobs]);

  const exportCsv = () => {
    const rows = [
      ["Company", "Position", "Status", "Applied", "Days to current stage", "Recruiter", "Last Updated", "Notes"],
      ...jobs.map((j) => {
        const e = elapsed(j);
        return [j.company, j.position, j.status, j.applied_at || "", e && !e.waiting ? String(e.days) : "", j.recruiter || "", j.last_updated || "", j.notes || ""];
      }),
    ];
    const csv = rows.map((r) => r.map((c) => `"${(c || "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "job-applications.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }} onClick={() => { setOpenDropdown(null); setAccountMenuOpen(false); }}>
      {/* Nav */}
      <nav style={{
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        padding: "0 1.5rem",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="2" y="7" width="20" height="14" rx="2"/>
            <path d="M16 3H8a2 2 0 0 0-2 2v2h12V5a2 2 0 0 0-2-2z"/>
            <path d="M9 12h6M9 16h4" strokeLinecap="round"/>
          </svg>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Job tracker</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
          <button
            onClick={(e) => { e.stopPropagation(); setAccountMenuOpen((o) => !o); }}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "6px 10px",
              color: "var(--text)",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ color: "var(--text-2)" }}>{session.user.email}</span>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>▾</span>
          </button>
          {accountMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                top: "110%",
                right: 0,
                zIndex: 60,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                minWidth: 260,
                padding: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Connected inboxes</div>
              {accountsLoading ? (
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>Loading…</div>
              ) : accounts.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-2)" }}>No inboxes linked yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {accounts.map((a) => (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--border-md)", borderRadius: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{a.provider === "google" ? "Gmail" : "Outlook"}</div>
                        <div style={{ fontSize: 11, color: "var(--text-2)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{a.account_email || "—"}</div>
                      </div>
                      <button
                        onClick={() => removeAccount(a.id)}
                        style={{ background: "transparent", border: "none", color: "var(--text-3)", fontSize: 14, padding: 4, cursor: "pointer" }}
                        title="Disconnect"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => connectProvider("google")}
                  style={{ background: "var(--surface2)", border: "1px solid var(--border-md)", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 500 }}
                >
                  + Add Gmail
                </button>
                <button
                  onClick={() => connectProvider("outlook")}
                  style={{ background: "var(--surface2)", border: "1px solid var(--border-md)", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 500 }}
                >
                  + Add Outlook
                </button>
              </div>
            </div>
          )}
          <button
            onClick={() => signOut()}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "5px 12px",
              color: "var(--text-2)",
              fontSize: 12,
            }}
          >
            Sign out
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Applications</h1>
            <p style={{ fontSize: 13, color: "var(--text-2)" }}>
              {lastSynced
                ? `Synced ${new Date(lastSynced).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${countdown !== null ? ` · next refresh in ${formatCountdown(countdown)}` : ""}`
                : "Connecting to your inboxes..."}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={exportCsv}
              disabled={jobs.length === 0}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border-md)",
                borderRadius: 8,
                padding: "8px 14px",
                color: "var(--text)",
                fontSize: 13,
              }}
            >
              Export CSV
            </button>
            <button
              onClick={() => load(true)}
              disabled={syncing}
              style={{
                background: "var(--blue-bg)",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                color: "var(--blue-text)",
                fontWeight: 500,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {syncing ? (
                <>
                  <span style={{ width: 14, height: 14, border: "1.5px solid", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block" }} />
                  Scanning...
                </>
              ) : "Refresh emails"}
            </button>
          </div>
        </div>

        {/* Stats */}
        {jobs.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: "1.5rem" }}>
            {[
              { label: "Total", value: stats.total },
              { label: "Active", value: stats.active },
              { label: "Offers", value: stats.offers },
              { label: "Rejections", value: stats.rejected },
            ].map((s) => (
              <div key={s.label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 26, fontWeight: 600 }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Insights */}
        {insights && (
          <div style={{ marginBottom: "1.5rem" }}>
            <button
              onClick={() => setShowInsights((v) => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "transparent", border: "1px solid var(--border)",
                borderRadius: 8, padding: "7px 14px", fontSize: 12.5,
                fontWeight: 500, color: "var(--text-2)", marginBottom: showInsights ? 12 : 0,
              }}
            >
              <span style={{ transform: showInsights ? "rotate(90deg)" : "none", transition: "transform .18s", display: "inline-block" }}>&#9656;</span>
              Insights
              <span style={{ color: "var(--text-3)", fontWeight: 400 }}>
                &middot; {insights.pct(insights.positive)}% callback &middot; {insights.perWeek}/week
              </span>
            </button>

            {showInsights && (
              <div style={{ display: "grid", gap: 10 }}>

                {/* headline rates */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                  {[
                    { label: "Callback rate", value: insights.pct(insights.positive) + "%", sub: `${insights.positive} of ${insights.total} moved forward`, color: "var(--green-text)" },
                    { label: "Any response", value: insights.pct(insights.responded) + "%", sub: `${insights.responded} replied (incl. rejections)`, color: "var(--blue-text)" },
                    { label: "Still waiting", value: insights.pct(insights.awaiting) + "%", sub: `${insights.awaiting} with no reply yet`, color: "var(--text-2)" },
                    { label: "Rejection rate", value: insights.pct(insights.rejected) + "%", sub: `${insights.rejected} explicit rejections`, color: "var(--red-text)" },
                  ].map((c) => (
                    <div key={c.label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ fontSize: 11.5, color: "var(--text-2)", marginBottom: 4 }}>{c.label}</div>
                      <div style={{ fontSize: 24, fontWeight: 600, color: c.color, lineHeight: 1.1 }}>{c.value}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{c.sub}</div>
                    </div>
                  ))}
                </div>

                {/* applications over time */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>Applications over time</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                      Busiest month: <strong style={{ color: "var(--text-2)" }}>
                        {new Date(insights.peakMonth[0] + "-02").toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                      </strong> ({insights.peakMonth[1]})
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130 }}>
                    {insights.months.map(([ym, n]) => {
                      const max = Math.max(...insights.months.map((x) => x[1])) || 1;
                      const isPeak = ym === insights.peakMonth[0];
                      return (
                        <div key={ym} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: isPeak ? "var(--text)" : "var(--text-3)", fontWeight: isPeak ? 600 : 400 }}>{n}</div>
                          <div title={`${ym}: ${n}`} style={{
                            width: "100%",
                            height: `${Math.max(3, (n / max) * 92)}px`,
                            background: isPeak ? "var(--blue)" : "var(--border-md)",
                            borderRadius: "4px 4px 0 0",
                            transition: "height .3s",
                          }} />
                          <div style={{ fontSize: 10.5, color: "var(--text-3)", whiteSpace: "nowrap" }}>
                            {new Date(ym + "-02").toLocaleDateString(undefined, { month: "short" })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* funnel + patterns */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>

                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 12 }}>Pipeline funnel</div>
                    {[
                      { label: "Applied", n: insights.total, color: "var(--blue)" },
                      { label: "Viewed", n: insights.viewed + insights.positive, color: "var(--gray-text)" },
                      { label: "Screening", n: insights.screening + insights.assessment + insights.interview + insights.offer, color: "var(--purple-text)" },
                      { label: "Assessment", n: insights.assessment + insights.interview + insights.offer, color: "var(--teal-text)" },
                      { label: "Interview", n: insights.interview + insights.offer, color: "var(--amber-text)" },
                      { label: "Offer", n: insights.offer, color: "var(--green-text)" },
                    ].map((r) => (
                      <div key={r.label} style={{ marginBottom: 9 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
                          <span style={{ color: "var(--text-2)" }}>{r.label}</span>
                          <span style={{ color: "var(--text-3)" }}>{r.n} &middot; {insights.pct(r.n)}%</span>
                        </div>
                        <div style={{ height: 7, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.max(0.6, (r.n / insights.total) * 100)}%`, background: r.color, borderRadius: 4, transition: "width .3s" }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 12 }}>Time to hear back</div>
                    {insights.responseTimes.length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--text-3)" }}>No replies with a known application date yet.</div>
                    ) : (
                      insights.responseTimes.map((r) => (
                        <div key={r.status} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                          <span style={{ color: "var(--text-2)" }}>{STATUS[r.status].label} <span style={{ color: "var(--text-3)" }}>({r.n})</span></span>
                          <span style={{ color: "var(--text)", textAlign: "right" }}>median {plural(r.median, "day")}</span>
                        </div>
                      ))
                    )}
                    {(() => {
                      const r = insights.responseTimes.find((x) => x.status === "rejected");
                      return r && r.n > 1 ? (
                        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 8, lineHeight: 1.6 }}>
                          Fastest rejection: {r.fastest.j.company} ({plural(r.fastest.e.days, "day")}) &middot; slowest: {r.slowest.j.company} ({plural(r.slowest.e.days, "day")})
                        </div>
                      ) : null;
                    })()}
                    <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 8, lineHeight: 1.6 }}>
                      {plural(insights.ghosted, "application")} with no reply after 30+ days
                      {insights.timedCount < insights.respondedRows && <> &middot; {insights.timedCount} of {insights.respondedRows} replies have a known application date</>}
                    </div>
                  </div>

                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 12 }}>Patterns</div>
                    {[
                      ["Busiest single day", insights.peakDay[0] ? `${formatDate(insights.peakDay[0])} — ${insights.peakDay[1]} apps` : "—"],
                      ["Most active weekday", `${insights.peakDow} (${insights.peakDowCount})`],
                      ["Average pace", `${insights.perWeek} applications / week`],
                      ["Tracking since", insights.firstDate ? formatDate(insights.firstDate.toISOString()) : "—"],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                        <span style={{ color: "var(--text-2)" }}>{k}</span>
                        <span style={{ color: "var(--text)", textAlign: "right" }}>{v}</span>
                      </div>
                    ))}
                    {insights.topCompanies.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 11.5, color: "var(--text-2)", marginBottom: 5 }}>Applied more than once</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {insights.topCompanies.map(([c, n]) => (
                            <span key={c} style={{ fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 20, padding: "3px 9px", color: "var(--text-2)" }}>
                              {c} &times;{n}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: "var(--red-bg)",
            border: "1px solid var(--red-text)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: "1rem",
            fontSize: 13,
            color: "var(--red-text)",
          }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Search */}
        <div style={{ position: "relative", marginBottom: "0.75rem", maxWidth: 420 }}>
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search company, role, recruiter, or notes..."
            style={{
              width: "100%",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 32px 9px 12px",
              fontSize: 13,
              color: "var(--text)",
              outline: "none",
            }}
          />
          {search && (
            <button
              onClick={() => { setSearch(""); setPage(1); }}
              title="Clear search"
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "transparent", border: "none", color: "var(--text-3)",
                fontSize: 15, lineHeight: 1, padding: 2,
              }}
            >&times;</button>
          )}
        </div>

        {/* Filters + Sort */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: "1rem" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map((f) => {
              const count = f === "all" ? searched.length : searched.filter((j) => j.status === f).length;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    background: filter === f ? "var(--surface)" : "transparent",
                    border: filter === f ? "1px solid var(--border-md)" : "1px solid transparent",
                    borderRadius: 20,
                    padding: "5px 13px",
                    fontSize: 12,
                    fontWeight: filter === f ? 500 : 400,
                    color: filter === f ? "var(--text)" : "var(--text-2)",
                  }}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)} ({count})
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--text-3)", whiteSpace: "nowrap" }}>Sort:</span>
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value); setPage(1); }}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border-md)",
                borderRadius: 8,
                padding: "5px 10px",
                fontSize: 12,
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              <option value="recent">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="company">Company A–Z</option>
              <option value="status">By status</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "4rem", color: "var(--text-2)" }}>
            <div style={{ width: 28, height: 28, border: "2px solid var(--border-md)", borderTopColor: "var(--text-2)", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 1rem" }} />
            <p>Scanning your inbox for job emails...</p>
            <p style={{ fontSize: 12, marginTop: 6, color: "var(--text-3)" }}>This may take a moment</p>
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ textAlign: "center", padding: "4rem", color: "var(--text-2)" }}>
            {jobs.length === 0 ? (
              <>
                <p style={{ fontSize: 15, fontWeight: 500, color: "var(--text)", marginBottom: 6 }}>No applications found</p>
                <p>No job-related emails were detected in your inbox.</p>
                <p style={{ fontSize: 12, marginTop: 8, color: "var(--text-3)" }}>Try clicking "Refresh now" or check that you have job emails in Gmail.</p>
              </>
            ) : (
              <p>No {filter} applications</p>
            )}
          </div>
        ) : (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Company / Position", "Status", "Response time", "Recruiter", "Last update", "Notes", ""].map((h, i) => (
                    <th key={i} style={{
                      padding: "10px 14px",
                      textAlign: "left",
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--text-3)",
                      background: "var(--surface2)",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((job, i) => (
                  <tr
                    key={job.id}
                    style={{
                      borderBottom: i < paginated.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <td style={{ padding: "12px 14px" }}>
                      {job.source_id ? (
                        <a
                          href={`https://mail.google.com/mail/u/0/#all/${job.source_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Open the source email in Gmail"
                          style={{ textDecoration: "none", color: "inherit", display: "block" }}
                        >
                          <div style={{ fontWeight: 500, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                            {job.company}
                            <span style={{ fontSize: 10, color: "var(--text-3)" }}>&#8599;</span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 1 }}>{job.position}</div>
                        </a>
                      ) : (
                        <>
                          <div style={{ fontWeight: 500, fontSize: 13 }}>{job.company}</div>
                          <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 1 }}>{job.position}</div>
                        </>
                      )}
                    </td>
                    <td style={{ padding: "12px 14px", position: "relative" }}>
                      <div
                        onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === job.id ? null : job.id); }}
                        style={{ display: "inline-block" }}
                        title="Click to change status"
                      >
                        <Badge status={job.status} editable />
                        {openDropdown === job.id && (
                          <StatusDropdown
                            jobId={job.id}
                            current={job.status}
                            onUpdate={updateStatus}
                            onClose={() => setOpenDropdown(null)}
                          />
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 12, whiteSpace: "nowrap" }}>
                      {(() => {
                        const e = elapsed(job);
                        if (!e) return <span style={{ color: "var(--text-3)" }}>&mdash;</span>;
                        const c = STATUS[job.status]?.color || "gray";
                        return (
                          <>
                            <div style={{ fontWeight: 500, color: e.waiting ? "var(--text-2)" : `var(--${c}-text)` }}>
                              {e.waiting ? `${plural(e.days, "day")} waiting` : `${STAGE_VERB[job.status] || job.status} after ${plural(e.days, "day")}`}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>Applied {formatDate(job.applied_at)}</div>
                          </>
                        );
                      })()}
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: job.recruiter ? "var(--text)" : "var(--text-3)" }}>
                      {job.recruiter || <em>not listed</em>}
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap" }}>
                      {formatDate(job.last_updated)}
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--text-2)", maxWidth: 420, whiteSpace: "normal", lineHeight: 1.6, verticalAlign: "top" }}>
                      {job.notes || "—"}
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <button
                        onClick={() => { if (confirm(`Remove "${job.company} — ${job.position}"?`)) deleteJob(job.id); }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--text-3)",
                          fontSize: 16,
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                        title="Remove"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {sorted.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: "12px", justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button
              onClick={() => load(true)}
              disabled={syncing}
              style={{ border: "1px solid var(--border-md)", background: "var(--surface)", padding: "6px 10px", borderRadius: 8, fontSize: 12, color: "var(--text)" }}
            >
              {syncing ? "Refreshing..." : "Refresh emails"}
            </button>
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sorted.length)} of {sorted.length}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{ border: "1px solid var(--border-md)", background: "var(--surface)", padding: "6px 10px", borderRadius: 8, fontSize: 12, color: "var(--text)" }}
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{ border: "1px solid var(--border-md)", background: "var(--surface)", padding: "6px 10px", borderRadius: 8, fontSize: 12, color: "var(--text)" }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 640px) {
          table td:nth-child(4), table th:nth-child(4) { display: none; }
        }
      `}</style>
    </div>
  );
}
