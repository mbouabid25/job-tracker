"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { signOut } from "next-auth/react";

const REFRESH_MS = 10 * 60 * 1000;

const STATUS = {
  applied:   { label: "Applied",    color: "purple" },
  screening: { label: "Screening",  color: "amber" },
  interview: { label: "Interview",  color: "blue" },
  offer:     { label: "Offer",      color: "teal" },
  rejected:  { label: "Rejected",   color: "red" },
  withdrawn: { label: "Withdrawn",  color: "gray" },
};

const FILTERS = ["all", "applied", "screening", "interview", "offer", "rejected", "withdrawn"];

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

export default function JobTracker({ session }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);
  const [filter, setFilter] = useState("all");
  const [countdown, setCountdown] = useState(null);
  const [openDropdown, setOpenDropdown] = useState(null);
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

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!nextRefreshAt.current) return;
    const tick = setInterval(() => {
      setCountdown(Math.max(0, nextRefreshAt.current - Date.now()));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastSynced]);

  const updateStatus = async (jobId, status) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status } : j)));
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

  const filtered = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  const stats = {
    total: jobs.length,
    active: jobs.filter((j) => ["applied", "screening", "interview"].includes(j.status)).length,
    offers: jobs.filter((j) => j.status === "offer").length,
    rejected: jobs.filter((j) => j.status === "rejected").length,
  };

  const exportCsv = () => {
    const rows = [
      ["Company", "Position", "Status", "Recruiter", "Last Updated", "Notes"],
      ...jobs.map((j) => [j.company, j.position, j.status, j.recruiter || "", j.last_updated || "", j.notes || ""]),
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
    <div style={{ minHeight: "100vh", background: "var(--bg)" }} onClick={() => setOpenDropdown(null)}>
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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>{session.user.email}</span>
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
                : "Connecting to Gmail..."}
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
              ) : "Refresh now"}
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

        {/* Filters */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "1rem" }}>
          {FILTERS.map((f) => {
            const count = f === "all" ? jobs.length : jobs.filter((j) => j.status === f).length;
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

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "4rem", color: "var(--text-2)" }}>
            <div style={{ width: 28, height: 28, border: "2px solid var(--border-md)", borderTopColor: "var(--text-2)", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 1rem" }} />
            <p>Scanning your inbox for job emails...</p>
            <p style={{ fontSize: 12, marginTop: 6, color: "var(--text-3)" }}>This may take a moment</p>
          </div>
        ) : filtered.length === 0 ? (
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
                  {["Company / Position", "Status", "Recruiter", "Last update", "Notes", ""].map((h, i) => (
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
                {filtered.map((job, i) => (
                  <tr
                    key={job.id}
                    style={{
                      borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{job.company}</div>
                      <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 1 }}>{job.position}</div>
                    </td>
                    <td style={{ padding: "12px 14px", position: "relative" }}>
                      <div onClick={(e) => { e.stopPropagation(); setOpenDropdown(openDropdown === job.id ? null : job.id); }} style={{ display: "inline-block" }}>
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
                    <td style={{ padding: "12px 14px", fontSize: 13, color: job.recruiter ? "var(--text)" : "var(--text-3)" }}>
                      {job.recruiter || <em>not listed</em>}
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap" }}>
                      {formatDate(job.last_updated)}
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--text-2)", maxWidth: 220 }}>
                      <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {job.notes || "—"}
                      </span>
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
