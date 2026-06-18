import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/oauth/outlook/callback`;
  const params = new URLSearchParams({
    client_id: process.env.AZURE_AD_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "offline_access Mail.Read User.Read openid profile email",
    state: encodeURIComponent(JSON.stringify({ owner: session.user.email })),
    prompt: "consent",
  });

  return NextResponse.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`);
}
