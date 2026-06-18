# Job Application Tracker

Automatically parse your Gmail and Outlook inboxes for job applications and track them from confirmation to offer, powered by Claude.

## Features

- Sign in with Google or Outlook (read-only mail access)
- Link multiple inboxes per user and scan them together
- Claude scans emails and extracts: company, position, recruiter, and status
- Status stages: Applied → Screening → Interview → Offer / Rejected
- Auto-refreshes every 30 minutes
- Manually override status with a click
- Export to CSV
- SQLite database persists data per user
- Dark mode support

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo>
cd job-tracker
npm install
```

### 2. Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable the **Gmail API**: APIs & Services → Library → Gmail API → Enable
4. Create OAuth credentials: APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google` (dev)
     - `https://your-domain.com/api/auth/callback/google` (production)
      - `http://localhost:3000/api/oauth/google/callback` (dev, for linking extra inboxes)
      - `https://your-domain.com/api/oauth/google/callback` (prod, for linking extra inboxes)
5. Copy the Client ID and Client Secret

### 2b. Microsoft Entra app (for Outlook)

1. Go to [portal.azure.com](https://portal.azure.com) → Microsoft Entra ID → App registrations → **New registration**
2. Supported account types: choose **Accounts in any organizational directory and personal Microsoft accounts**
3. Redirect URI type **Web**:
   - `http://localhost:3000/api/auth/callback/azure-ad` (dev)
   - `https://your-domain.com/api/auth/callback/azure-ad` (prod)
   - Also add the custom OAuth callback used for linking extra inboxes:
     - `http://localhost:3000/api/oauth/outlook/callback`
     - `https://your-domain.com/api/oauth/outlook/callback`
4. After creating, go to **Certificates & secrets** → **New client secret** and copy the value
5. In **API permissions**, add **Microsoft Graph** → Delegated → `Mail.Read` and `offline_access`
6. Copy the Application (client) ID and Directory (tenant) ID

### 3. Environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in the values:

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
# Outlook (Microsoft)
AZURE_AD_CLIENT_ID=your_azure_app_client_id
AZURE_AD_CLIENT_SECRET=your_azure_app_client_secret
AZURE_AD_TENANT_ID=common
NEXTAUTH_SECRET=$(openssl rand -base64 32)
NEXTAUTH_URL=http://localhost:3000
ANTHROPIC_API_KEY=your_anthropic_key
```

Get your Anthropic API key from [console.anthropic.com](https://console.anthropic.com).

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployment

### Railway (recommended)

1. Push your code to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables in the Railway dashboard
4. Set `NEXTAUTH_URL` to your Railway domain (e.g. `https://job-tracker.up.railway.app`)
5. Add `data/` as a persistent volume mount so the SQLite DB survives deploys

### Render

1. Push to GitHub
2. New Web Service → connect repo
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Add environment variables
6. Add a Disk (persistent storage) mounted at `/opt/render/project/src/data`

### Vercel

Vercel doesn't support persistent file storage, so SQLite won't work across deploys. Use [Turso](https://turso.tech) instead:

1. Install `@libsql/client` and replace `lib/db.js` with Turso client calls
2. Or use Vercel Postgres via `@vercel/postgres`

---

## Sharing with friends

Each person signs in with their own Google account — they only see their own applications. Just share the URL after deploying.

To let others use it:
- In Google Cloud Console → OAuth consent screen → Add test users (during dev)
- Or publish the app (requires Google verification for production use with many users)

---

## How it works

1. On login, NextAuth.js requests Gmail read-only OAuth access
2. On each refresh, the server fetches emails from the past 6 months using targeted Gmail search queries
3. Email subjects, senders, and previews are sent to Claude (`claude-sonnet-4-20250514`)
4. Claude classifies each unique application by company + position and assigns a status
5. Results are upserted into a SQLite database keyed by user email
6. The frontend polls every 30 minutes (or on demand)
