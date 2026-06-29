export const maxDuration = 60; // Vercel max for hobby plan

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchJobEmailsForUser, ensureSessionAccount, markEmailsAsProcessed } from "@/lib/mail";
import { classifyApplications } from "@/lib/classifier";
import { upsertJobs, getJobs, getLastSynced, markSynced } from "@/lib/db";
import { NextResponse } from "next/server";

const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (session.error === "RefreshAccessTokenError") {
    return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
  }

  const userId = session.user.email;
  const { searchParams } = new URL(req.url);
  const forceRefresh = searchParams.get("refresh") === "true";

  try {
    await ensureSessionAccount(session);
  } catch (e) {
    console.error("Failed to persist primary account", e);
  }

  const lastSynced = await getLastSynced(userId);
  const cacheValid =
    lastSynced &&
    Date.now() - new Date(lastSynced.endsWith("Z") ? lastSynced : lastSynced + "Z").getTime() < CACHE_TTL_MS;

  if (!forceRefresh && cacheValid) {
    return NextResponse.json({
      jobs: await getJobs(userId),
      lastSynced,
      cached: true,
    });
  }

  try {
    const emails = await fetchJobEmailsForUser(userId, lastSynced || null);
    await markEmailsAsProcessed(userId, emails);
    const classified = await classifyApplications(emails);
    if (classified.length > 0) await upsertJobs(userId, classified);
    else await markSynced(userId);
    return NextResponse.json({
      jobs: await getJobs(userId),
      lastSynced: new Date().toISOString(),
      cached: false,
      found: classified.length,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { updateJobStatus } = await import("@/lib/db");
  const { id, status } = await req.json();
  await updateJobStatus(session.user.email, id, status);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { deleteJob } = await import("@/lib/db");
  const { id } = await req.json();
  await deleteJob(session.user.email, id);
  return NextResponse.json({ ok: true });
}
