import { listMailAccounts, upsertMailAccount, updateMailAccountTokens, filterUnseenEmails, markEmailsProcessed } from "./db";
import { getJobEmails as getGmailJobEmails } from "./gmail";
import { getOutlookJobEmails } from "./outlook";
import { refreshGoogleToken, refreshMicrosoftToken } from "./tokens";

const PROVIDER_MAP = {
  google: {
    fetcher: getGmailJobEmails,
    refresher: refreshGoogleToken,
  },
  outlook: {
    fetcher: getOutlookJobEmails,
    refresher: refreshMicrosoftToken,
  },
};

export function normalizeProvider(provider) {
  if (provider === "azure-ad") return "outlook";
  if (provider === "google") return "google";
  return provider;
}

export async function ensureSessionAccount(session) {
  const provider = normalizeProvider(session?.provider);
  if (!provider || !PROVIDER_MAP[provider]) return;
  if (!session?.accessToken) return;
  const ownerId = session.user?.email || session.accountEmail || session.email;
  const accountEmail = session.accountEmail || session.user?.email;
  await upsertMailAccount({
    ownerId,
    provider,
    accountEmail,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.accessTokenExpires,
    scope: provider === "google" ? "https://www.googleapis.com/auth/gmail.readonly" : "https://graph.microsoft.com/Mail.Read",
  });
}

async function getFreshToken(account) {
  const provider = normalizeProvider(account.provider);
  const helper = PROVIDER_MAP[provider];
  if (!helper) return { accessToken: account.access_token, refreshToken: account.refresh_token, expiresAt: account.expires_at };

  const needsRefresh = account.expires_at && Number(account.expires_at) - 60_000 < Date.now();
  if (!needsRefresh || !account.refresh_token) {
    return { accessToken: account.access_token, refreshToken: account.refresh_token, expiresAt: account.expires_at };
  }

  const refreshed = await helper.refresher(account.refresh_token);
  await updateMailAccountTokens(account.id, {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
  });
  return {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
  };
}

export async function fetchJobEmailsForUser(ownerId, sinceDate) {
  const accounts = await listMailAccounts(ownerId);
  if (!accounts.length) {
    throw new Error("No inboxes are connected. Add Gmail or Outlook to scan.");
  }

  const all = [];
  for (const account of accounts) {
    const provider = normalizeProvider(account.provider);
    const helper = PROVIDER_MAP[provider];
    if (!helper) continue;

    try {
      const fresh = await getFreshToken(account);
      const emails = await helper.fetcher(fresh.accessToken, sinceDate);

      const ids = emails.map((e) => e.id).filter(Boolean);
      const alreadySeen = await filterUnseenEmails(ownerId, ids);
      const newEmails = emails.filter((e) => !alreadySeen.has(e.id));

      all.push(
        ...newEmails.map((e) => ({
          ...e,
          provider,
          account: account.account_email,
        }))
      );
    } catch (e) {
      console.error(`Failed to scan ${provider} account ${account.account_email}`, e);
    }
  }
  return all;
}

export async function markEmailsAsProcessed(ownerId, emails) {
  const ids = emails.map((e) => e.id).filter(Boolean);
  await markEmailsProcessed(ownerId, ids);
}
