# Deployment guide

Tafaqqah is a standard Next.js 16 application backed by PostgreSQL. It has no local-only state: accounts, sessions, progress, mastery, memorization history and AI logs all live in the database.

## 1. Database

Use a **new, dedicated** PostgreSQL 14+ database for every public deployment. Never point a deployment at a development database: it must not contain development accounts or personal learner data.

- Copy the connection string into `DATABASE_URL`. On serverless platforms prefer the pooled connection string.
- Apply migrations, then seed **once** into the empty database:

```bash
DATABASE_URL="postgres://…" npm run db:deploy
DATABASE_URL="postgres://…" ADMIN_EMAIL="…" ADMIN_PASSWORD="…" npm run db:seed
```

The seed loads the learning path and `prisma/seed-data/release-content.json`: Lesson 1 (published) and the approved Matn units. It contains no users, sessions or learner data. Lesson 2 is not included.

## 2. Environment variables

Set these only in the host's environment settings, never in the repository.

| Variable | Value |
|---|---|
| `DATABASE_URL` | the deployment's own PostgreSQL URL |
| `AI_PROVIDER` | `gemini` (or `anthropic`) |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | the provider key (server-side only) |
| `ASSESSMENT_MODE_STRATEGY` | `adaptive` |
| `AI_RATE_LIMIT_PER_10_MIN` | optional, default `40` |

Never set `AI_PROVIDER=mock` in production. The app refuses it there and reports that AI is not configured: AI follow-ups are skipped with an honest message, and the approved question bank stays available.

`ADMIN_EMAIL` / `ADMIN_PASSWORD` are read **only by the seed / bootstrap scripts**, not by the web app.

## 3. Judging admin account

Judges get a dedicated application account with the real `ADMIN` role. It is not the maintainer's personal account.

1. Choose the judging email (for example `judge.admin@tafaqqah.app`) and generate a **new random password** (at least 12 characters) used nowhere else.
2. Create the account with the existing bootstrap, run against the deployment database:

   ```bash
   DATABASE_URL="postgres://…" ADMIN_EMAIL="judge.admin@tafaqqah.app" ADMIN_PASSWORD="<new password>" npx tsx scripts/bootstrap-admin.ts
   ```

   (or pass both variables to the first `npm run db:seed` / the Docker `migrate` job). The password is stored only as a hash; it is never written to source code.
3. Sign in at `/admin/login` and check the console works.
4. Only then put the URL, email and password in the README. Once published they are **public judging credentials**, not secrets.

What the account can and cannot reach:

- It can use every admin feature of the app: content, sources, review/approval, Matn, AI logs, analytics, evaluation export, students and audit log. Its changes are real and are recorded in `/admin/audit`.
- It cannot grant the admin role to anyone (only `npm run admin:promote` on the server can).
- No page shows environment variables, API keys or database credentials. `/admin/settings` shows only the provider and model names.
- It has no access to the host, the database server, GitHub, the AI provider account or any other service.

After judging, remove the account or change its password. Re-running the bootstrap for an existing email only ensures the role; it does not change the password.

## 4. Docker (any container host)

```bash
docker build -t tafaqqah .                              # runtime image (non-root, health check)
docker build -t tafaqqah-migrate --target migrate .     # migrations + first-boot seed job
docker run --rm -e DATABASE_URL=... -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... tafaqqah-migrate   # seeds only an empty DB
docker run -p 3000:3000 -e DATABASE_URL=... -e AI_PROVIDER=gemini -e GEMINI_API_KEY=... tafaqqah
```

Or `docker compose up --build` after `cp .env.example .env` (see the README).

> Verified on 2026-10-05 with Docker Engine 29 / Compose 2.40: clean clone → `cp .env.example .env` → `docker compose up --build` → migrations from an empty database, first-boot seed, app healthy; restarts do not re-seed.

## 5. Vercel / any Node host

```bash
npm ci
npm run build          # prisma generate && next build
npm run db:deploy
NODE_ENV=production npm start   # listens on $PORT or 3000
```

On Vercel: add the environment variables above, deploy, then run migrations and the seed against the same database. The question endpoint (`/api/assessment/[sessionId]/next`) declares `maxDuration = 120`: each question has a 90 s budget (generator + validator, up to 3 attempts) and fails closed when it runs out.

## 6. Verify the deployment

- `GET /api/health` returns `{"status":"ok","database":"ok","ai":{"configured":true,…}}`. `503` means the database is unreachable; `"degraded"` means AI is not configured.
- Register a new learner and walk the journey: Lesson 1 → study → assessment → result → targeted review → memorization → log out → log in again (progress persists).
- Sign in as the judging admin and check `/admin/logs`: generated questions show passage version, prompt versions and models, with accepted and rejected candidates.
- **Live Gemini behaviour has not been verified yet** (the release audit made 0 real calls). Verify it on the deployment: answer a baseline question wrongly and confirm a verification question appears and is logged in `/admin/logs`.

## Security checklist

- Secrets live only in the host's environment settings. `.env*` is git-ignored except `.env.example`, and excluded from the Docker build context.
- Cookies are `httpOnly`, `SameSite=Lax`, and `Secure` in production.
- Security headers (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`) are set in `next.config.ts`.
- Admin pages return `404` to non-admins; admin services and the evaluation export return `403`.
- The deployment database is separate from development and starts with no personal data.
