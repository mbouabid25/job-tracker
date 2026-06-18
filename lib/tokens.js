const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const MICROSOFT_TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export async function refreshGoogleToken(refreshToken) {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed to refresh Google token");
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    refreshToken: json.refresh_token || refreshToken,
    scope: json.scope,
  };
}

export async function refreshMicrosoftToken(refreshToken) {
  const res = await fetch(MICROSOFT_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AZURE_AD_CLIENT_ID,
      client_secret: process.env.AZURE_AD_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "offline_access https://graph.microsoft.com/Mail.Read",
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Failed to refresh Outlook token");
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    refreshToken: json.refresh_token || refreshToken,
    scope: json.scope,
  };
}
