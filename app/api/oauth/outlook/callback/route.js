import { NextResponse } from "next/server";
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

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/oauth/outlook/callback`;
  try {
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET,
        scope: "offline_access Mail.Read User.Read openid profile email",
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      return NextResponse.json({ error: tokens.error || "Token exchange failed" }, { status: 500 });
    }

    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    let accountEmail = null;
    try {
      const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const me = await meRes.json();
      accountEmail = me.mail || me.userPrincipalName || null;
    } catch (_) {}

    upsertMailAccount({
      ownerId: owner,
      provider: "outlook",
      accountEmail,
      accessToken,
      refreshToken,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
      scope: tokens.scope,
    });

    const html = `<script>window.opener && window.opener.postMessage({ type: 'account-linked', provider: 'outlook', email: '${accountEmail}' }, '*'); window.close();</script><p>Outlook inbox connected. You can close this window.</p>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
