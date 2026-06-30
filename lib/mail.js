import { listMailAccounts, upsertMailAccount, updateMailAccountTokens, filterUnseenEmails, markEmailsProcessed } from "./db";
import { listJobMessageIds, getJobEmailDetails } from "./gmail";
import { listOutlookJobMessageIds, getOutlookJobEmailDetails } from "./outlook";
import { refreshGoogleToken, refreshMicrosoftToken } from "./tokens";

const MAX_PER_SYNC = 75;

const PROVIDER_MAP = {
  google: {
    lister: listJobMessageIds,
    detailer: getJobEmailDetails,
    refresher: refreshGoogleToken,
  },
  outlook: {
    lister: listOutlookJobMessageIds,
    detailer: getOutlookJobEmailDetails,
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

      // Cheap step: list candidate message IDs only, then filter out anything
      // already processed BEFORE deciding which ones to fetch full details for.
      // Otherwise the same top-N search results get re-fetched and discarded
      // on every sync, and new emails further down the list never get reached.
      const candidateIds = await helper.lister(fresh.accessToken, sinceDate);
      const alreadySeen = await filterUnseenEmails(ownerId, candidateIds);
      const unseenIds = candidateIds.filter((id) => !alreadySeen.has(id)).slice(0, MAX_PER_SYNC);

      const emails = await helper.detailer(fresh.accessToken, unseenIds);

      all.push(
        ...emails.map((e) => ({
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
