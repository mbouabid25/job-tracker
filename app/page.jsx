"use client";
import { useSession, signIn, signOut } from "next-auth/react";
import { SessionProvider } from "next-auth/react";
import JobTracker from "@/components/JobTracker";

function Landing() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
      textAlign: "center",
    }}>
      <div style={{ marginBottom: "2rem" }}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ margin: "0 auto 1.25rem" }}>
          <rect x="4" y="12" width="40" height="28" rx="4" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.3"/>
          <path d="M4 20h40" stroke="currentColor" strokeWidth="2" opacity="0.5"/>
          <rect x="14" y="6" width="6" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" fill="none"/>
          <rect x="28" y="6" width="6" height="8" rx="1.5" stroke="currentColor" strokeWidth="2" fill="none"/>
          <path d="M12 30h8M12 36h16M28 30h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
        </svg>
        <h1 style={{ fontSize: "28px", fontWeight: "600", marginBottom: "0.5rem" }}>
          Job application tracker
        </h1>
        <p style={{ color: "var(--text-2)", maxWidth: "420px", lineHeight: "1.7" }}>
          Automatically parse your Gmail or Outlook for job applications and track them from
          confirmation to offer. Powered by Claude.
        </p>
      </div>

      <button
        onClick={() => signIn("google")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          background: "var(--surface)",
          border: "1px solid var(--border-md)",
          borderRadius: "10px",
          padding: "12px 22px",
          fontSize: "14px",
          fontWeight: "500",
          color: "var(--text)",
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/>
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/>
        </svg>
        Sign in with Google
      </button>

      <button
        onClick={() => signIn("azure-ad")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          background: "var(--surface)",
          border: "1px solid var(--border-md)",
          borderRadius: "10px",
          padding: "12px 22px",
          fontSize: "14px",
          fontWeight: "500",
          color: "var(--text)",
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          marginTop: "10px",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 4h16v16H4z" fill="#0078d4" stroke="none" />
          <path d="M6 6h5v12H6z" fill="white" stroke="none" />
          <path d="M13 6h5v12h-5z" fill="#d7e5f6" stroke="none" />
        </svg>
        Sign in with Outlook
      </button>

      <p style={{ marginTop: "1.5rem", fontSize: "12px", color: "var(--text-3)", maxWidth: "360px" }}>
        We request read-only mail access (Gmail/Outlook). Your emails are processed by Claude and never stored beyond the extracted application data.
      </p>
    </div>
  );
}

function App() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "24px", height: "24px", border: "2px solid var(--border-md)", borderTopColor: "var(--text-2)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!session) return <Landing />;
  return <JobTracker session={session} />;
}

export default function Page() {
  return (
    <SessionProvider>
      <App />
    </SessionProvider>
  );
}
