import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import { refreshGoogleToken, refreshMicrosoftToken } from "./tokens";

const GOOGLE_SCOPES = "openid email profile https://www.googleapis.com/auth/gmail.readonly";
const OUTLOOK_SCOPES = "openid profile email offline_access https://graph.microsoft.com/Mail.Read";

async function refreshAccessToken(token) {
  try {
    if (token.provider === "google") {
      const refreshed = await refreshGoogleToken(token.refreshToken);
      return {
        ...token,
        accessToken: refreshed.accessToken,
        accessTokenExpires: refreshed.expiresAt,
        refreshToken: refreshed.refreshToken ?? token.refreshToken,
      };
    }
    if (token.provider === "azure-ad") {
      const refreshed = await refreshMicrosoftToken(token.refreshToken);
      return {
        ...token,
        accessToken: refreshed.accessToken,
        accessTokenExpires: refreshed.expiresAt,
        refreshToken: refreshed.refreshToken ?? token.refreshToken,
      };
    }
    return { ...token, error: "RefreshAccessTokenError" };
  } catch (e) {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      tenantId: process.env.AZURE_AD_TENANT_ID || "common",
      authorization: { params: { scope: OUTLOOK_SCOPES } },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          provider: account.provider,
          accountEmail: account.email,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: (account.expires_at || account.expires_in || 0) * 1000 || Date.now() + 60 * 60 * 1000,
        };
      }
      if (Date.now() < token.accessTokenExpires) return token;
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken;
      session.accessTokenExpires = token.accessTokenExpires;
      session.provider = token.provider;
      session.accountEmail = token.accountEmail || session.user.email;
      session.error = token.error;
      return session;
    },
  },
  pages: { signIn: "/" },
};
