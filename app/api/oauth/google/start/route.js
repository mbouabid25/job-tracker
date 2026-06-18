import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { google } from "googleapis";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/oauth/google/callback`;
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly"],
    state: encodeURIComponent(JSON.stringify({ owner: session.user.email })),
  });

  return NextResponse.redirect(url);
}
