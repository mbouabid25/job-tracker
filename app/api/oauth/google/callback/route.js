import { NextResponse } from "next/server";
import { google } from "googleapis";
import { upsertMailAccount } from "@/lib/db";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");

  let owner;
  try {
    owner = JSON.parse(decodeURIComponent(stateParam || ""))?.owner;
  } catch (_) {}

  if (!code || !owner) {
    return NextResponse.json({ error: "Missing code or owner" }, { status: 400 });
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/oauth/google/callback`;
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  try {
    const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const profile = await oauth2.userinfo.get();
    const accountEmail = profile.data.email;

    upsertMailAccount({
      ownerId: owner,
      provider: "google",
      accountEmail,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date || (tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null),
      scope: tokens.scope,
    });

    const html = `<script>window.opener && window.opener.postMessage({ type: 'account-linked', provider: 'google', email: '${accountEmail}' }, '*'); window.close();</script><p>Google inbox connected. You can close this window.</p>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
