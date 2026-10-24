# ReachInbox Email Scheduler

A full-stack TypeScript email scheduler assignment using Express, React, BullMQ, Redis, PostgreSQL, Ethereal SMTP, Elasticsearch, Google OAuth and Slack notifications.

> **Verification status:** This source is an implementation starter. External credentials and a local build/end-to-end run are still required. Do not claim an integration is verified until its test below passes.

## Architecture

- `apps/api/src/server.ts`: Express API, Redis-backed sessions, Google OAuth, email routes, integrations, protected Bull Board and startup recovery.
- `apps/api/src/workers/email-worker.ts`: dedicated BullMQ worker for SMTP delivery, sender selection, rate limits, retries and Slack alerts.
- `apps/api/prisma/schema.prisma`: PostgreSQL source of truth for users, campaigns, email states and Slack connections.
- `apps/api/src/services/queue-recovery.ts`: reconcile `SCHEDULED` database rows with BullMQ jobs at API startup. No cron jobs or cron libraries are used.
- `apps/api/src/services/email-indexer.ts` plus `apps/api/src/lib/index-queue.ts`: persistent BullMQ search-index jobs with retries and startup reconciliation. PostgreSQL remains authoritative.
- `apps/web`: React + Vite + TypeScript + Tailwind UI with CSV/TXT import, compose, scheduled/sent/failed views and Slack connection controls.
- `docker-compose.yml`: PostgreSQL 16, Redis 7 with AOF persistence, Elasticsearch 8.

## Prerequisites

Node.js 20+, npm, Git, VS Code (recommended), Docker Desktop/Engine with Compose, a Google Cloud OAuth web client, an Ethereal test SMTP account, and a Slack app/workspace for live notifications.

## Setup on Windows (PowerShell)

Run from the repository root after extracting/cloning:

```powershell
Copy-Item .env.example apps/api/.env
docker compose up -d
docker compose ps
npm install
npm run db:generate
npm run db:migrate
```

Edit `apps/api/.env` as described below. Start these commands in **three separate terminals** at the repository root:

```powershell
npm run dev:api
```

```powershell
npm run dev:worker
```

```powershell
npm run dev:web
```

Open `http://localhost:5173`. API health: `http://localhost:4000/health`. Bull Board: `http://localhost:4000/admin/queues`, requiring Google login and the configured HTTP Basic credentials.

## Setup on macOS / Linux

```bash
cp .env.example apps/api/.env
docker compose up -d
npm install
npm run db:generate
npm run db:migrate
# Run separately, each in its own terminal from the repo root:
npm run dev:api
npm run dev:worker
npm run dev:web
```

## Configure `.env`

Edit **`apps/api/.env`**, not the committed sample. Never commit real credentials.

- `DATABASE_URL`, `REDIS_URL`, `ELASTICSEARCH_URL`: defaults point to local Docker services.
- `SESSION_SECRET`: use a random string of at least 32 characters.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: needed for Google login.
- `SMTP_SENDERS_JSON`: a valid one-line JSON array of SMTP profiles; `DEFAULT_SENDER_KEY` must match a configured `key`.
- `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`: needed for Slack OAuth.
- `TOKEN_ENCRYPTION_KEY`: a base64-encoded random 32-byte key used to encrypt Slack bot tokens at rest. Generate it locally with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep it stable and backed up securely; changing it means existing Slack connections need to be reconnected.
- `WORKER_CONCURRENCY=5`: worker concurrency.
- `MIN_SEND_INTERVAL_MS=2000`: minimum spacing for the same sender.
- `MAX_EMAILS_PER_HOUR_PER_SENDER=200`: configurable Redis-backed sender cap.
- `RATE_LIMIT_RETRY_JITTER_MS=250`: avoids synchronized retry spikes.
- `BULL_BOARD_USERNAME` and `BULL_BOARD_PASSWORD`: change the demo defaults.

Example Ethereal profile (replace placeholders; keep JSON on one line):

```env
SMTP_SENDERS_JSON=[{"key":"ethereal-primary","name":"ReachInbox Demo","email":"YOUR_ETHEREAL_FROM_ADDRESS","host":"smtp.ethereal.email","port":587,"secure":false,"user":"YOUR_ETHEREAL_USER","pass":"YOUR_ETHEREAL_PASSWORD"}]
DEFAULT_SENDER_KEY=ethereal-primary
```

Create **two separate test sender accounts** at https://ethereal.email/ so the multiple-sender requirement can be demonstrated. Put both account profiles into the same `SMTP_SENDERS_JSON` array using distinct `key` values (for example `ethereal-primary` and `ethereal-secondary`), and use each account's own generated `email`, SMTP username, and password. The SMTP host is `smtp.ethereal.email`, port `587`, with `secure=false` (STARTTLS). These emails are captured for preview rather than delivered to real inboxes. A preview URL is logged by the worker.

## Google OAuth setup

1. Visit https://console.cloud.google.com/ and choose/create a project.
2. Configure the OAuth consent screen. For testing mode, add your Google account as a test user.
3. Create an OAuth Client ID with application type **Web application**.
4. Add this exact authorized redirect URI: `http://localhost:4000/api/auth/google/callback`.
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` in `apps/api/.env`, then restart the API.
6. Open the dashboard and sign in with Google. `/api/auth/me` returns the profile; `POST /api/auth/logout` logs out.

The OAuth flow is implemented but cannot sign in until you supply credentials from your Google Cloud project. Keep the client secret only in `apps/api/.env` and never send it in chat or commit it.

## Slack OAuth setup

1. Create an app at https://api.slack.com/apps in a test workspace.
2. Under OAuth & Permissions, add `http://localhost:4000/api/integrations/slack/callback` as a redirect URL.
3. Add bot scopes `chat:write` and `im:write`, then install/reinstall the app in the workspace.
4. Generate `TOKEN_ENCRYPTION_KEY` with the command above, then set it together with `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_CALLBACK_URL` in `apps/api/.env`.
5. Sign in and choose **Connect Slack**. The authorized connection is stored for the user, with the Slack bot token encrypted using AES-256-GCM and `TOKEN_ENCRYPTION_KEY`. A real Slack DM is sent when a sender's hourly limit is reached. Without a saved connection, rate limiting still works but notifications are skipped safely.
6. Test disconnect/reconnect using the dashboard.

## Scheduling, persistence and delivery semantics

- Each recipient is stored as a PostgreSQL row and scheduled via a BullMQ delayed job with a stable ID. Startup reconciliation restores missing jobs. No cron scheduler is used.
- Redis AOF and named PostgreSQL volumes preserve local state across process/container restarts.
- The schedule API requires the `Idempotency-Key` header; replaying the same key for a user returns the existing campaign. The key must be stable across retries of one logical request and must be new for a genuinely new campaign. The API also rejects start times that are not in the future.
- An atomic Redis Lua reservation shares sender/campaign hourly counters and sender spacing across workers. Over-limit jobs are rescheduled to the next available window, not discarded. Users sharing a sender profile share that provider cap.
- Slack rate-limit alerts are deduplicated by sender/hour/user to avoid flooding the workspace.
- SMTP cannot guarantee exactly-once delivery after a crash between provider acceptance and database status update. Old `SENDING` records are marked `FAILED` for manual review rather than blindly resent, preferring to avoid duplicates. An SMTP failure may still consume a reserved hourly slot.
- Elasticsearch indexes recipient/subject/body for `GET /api/emails/search?q=...`; PostgreSQL is the source of truth. Index operations go through a persistent BullMQ indexing queue with exponential retries; startup reconciliation requeues all current email rows in batches so an interrupted or stale index can be rebuilt. Permanent index failures remain visible in the BullMQ dashboard for inspection.

## API routes

- `GET /health`
- `GET /api/auth/google`, `GET /api/auth/google/callback`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/emails/senders`, `POST /api/emails/schedule`
- `GET /api/emails?status=scheduled|sent|failed`, `GET /api/emails/search?q=term`
- `GET /api/integrations/slack/status`, `GET /api/integrations/slack/connect`, `GET /api/integrations/slack/callback`, `DELETE /api/integrations/slack`
- `GET /admin/queues` (Google session + Basic auth)

Schedule body fields: `subject`, `body`, `recipients`, `scheduledAt`, `delaySeconds`, `hourlyLimit`, `senderKey`.

## Continuous integration

GitHub Actions installs workspace dependencies, generates the Prisma client, runs the API unit tests (`npm test`), and builds the API/frontend TypeScript projects for pushes and pull requests to `main`. The automated tests cover request-schema boundaries, SMTP sender configuration validation, and Slack-token encryption integrity. They do not prove that Google/Slack OAuth, live SMTP delivery, Redis queue recovery, or Elasticsearch search work; those integrations still need the local smoke checks below.

## Verification checklist before submission

1. `npm run build` passes.
2. Schedule a future email, inspect DB/queue, restart API + worker, and verify the email still sends at the intended time.
3. Repeat a request with the same idempotency key and confirm no duplicate campaign/job.
4. Set `MAX_EMAILS_PER_HOUR_PER_SENDER=2`, queue more emails, and verify overflow is delayed rather than dropped.
5. Connect Slack and verify a real DM on rate-limit hit.
6. Search by recipient/subject via Elasticsearch.
7. Verify Google login/profile/logout, CSV parsing, loading/error/empty states, Slack disconnect/reconnect and Bull Board protection.
8. Record a demo under five minutes showing scheduling, Scheduled/Sent lists, restart recovery and rate-limit behavior.

## Troubleshooting

- Docker startup: run `docker compose ps` and `docker compose logs postgres redis elasticsearch`; Elasticsearch needs sufficient Docker memory.
- Prisma/database errors: wait for PostgreSQL health, check `DATABASE_URL`, then run `npm run db:generate` and `npm run db:migrate`.
- Google callback errors: check web client type, test-user allowlist and the exact redirect URI; restart the API after env edits.
- No SMTP sender: validate the one-line JSON and ensure `DEFAULT_SENDER_KEY` matches a sender's `key`. Do not use a personal Gmail password.
- Slack errors: verify redirect URL, bot scopes, workspace installation and client credentials.
- Frontend/API issue: keep web on port 5173 and API on 4000; check origins and cookies.
- Port conflicts: stop the conflicting service or adjust Docker port mappings and matching env values.
- Destructive local reset only: `docker compose down -v` removes all database, Redis and Elasticsearch volumes, including scheduled jobs.

## Limitations / submission notes

This is a local assignment starter, not a production deployment. Use HTTPS, secure secret storage, restricted CORS, tenant isolation, retention controls and managed services in production. OAuth/SMTP/Slack credentials are intentionally excluded. Run the build and test each integration locally before claiming verification; note any known issues in your demo/submission.
