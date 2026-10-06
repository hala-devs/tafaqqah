# تفقّه | Tafaqqah
**Source-grounded learning, assessment, and memorization for structured Hanbali fiqh study.**

Tafaqqah helps learners study approved lesson content, check their understanding, revisit weak concepts at linked source segments, and memorize approved matn units. AI operates only inside server-enforced source, validation, and fallback boundaries; it does not issue fatwas, select sources, approve content, grade answers, or decide mastery.

## Live Demo

**Production:** <https://tafaqqah.onrender.com/>

### Judge Admin Access

A dedicated demo account is available for the judging committee.

- **Admin URL:** <https://tafaqqah.onrender.com/admin>
- **Email:** `judge.admin@tafaqqah.app`
- **Password:** `Admin@#@1239`

This is a dedicated judging/demo account for the deployed admin console. It does not provide infrastructure, database, source-control, or AI-provider access.

## Judge Quick Start

### A. Learner experience

1. Open the [live application](https://tafaqqah.onrender.com/), register a learner account, and sign in.
2. Open **المسار العلمي** (`/curriculum`) and select the available published lesson.
3. Read the lesson and inspect its **المصدر العلمي** card.
4. Select **أكملت دراسة الدرس**, then **ابدأ اختبار فهمك**.
5. Answer baseline questions. A wrong answer can trigger a source-bounded verification question; if the provider is unavailable, the system fails closed instead of inventing one.
6. When offered, select **راجع هذا الجزء** to see an approved timestamped segment or approved passage, then select **اختبر فهمي مرة أخرى**.
7. Open **مسار الحفظ** (`/memorize`), choose an available matn passage, record locally, self-assess, and inspect the result/review date.
8. Open **المراجعة** (`/review`) or **تقدمي** (`/progress`) to see persisted learner state.

Dynamic lesson, assessment, review, recitation, reinforcement, and result routes need server-issued identifiers. Reach them through the interface; they are deliberately not linked directly here.

### B. Admin / AI evaluation experience

1. Open [Admin login](https://tafaqqah.onrender.com/admin/login) and use the judge account.
2. Start at [Admin overview](https://tafaqqah.onrender.com/admin).
3. Inspect [Sources](https://tafaqqah.onrender.com/admin/sources), then [Content review](https://tafaqqah.onrender.com/admin/review).
4. Inspect [Matn management](https://tafaqqah.onrender.com/admin/matn) and [Curriculum](https://tafaqqah.onrender.com/admin/curriculum).
5. Open [AI overview](https://tafaqqah.onrender.com/admin/ai), then [AI logs](https://tafaqqah.onrender.com/admin/logs). Open a listed candidate from the UI to inspect its source snapshot, deterministic checks, validator result, and display status.
6. Open [Evaluation](https://tafaqqah.onrender.com/admin/evaluation), [Analytics](https://tafaqqah.onrender.com/admin/analytics), [Students](https://tafaqqah.onrender.com/admin/students), and [Audit log](https://tafaqqah.onrender.com/admin/audit).

## Direct Judge Links

| Page | Purpose | Direct link |
| --- | --- | --- |
| Admin overview | Content, approval, and operational overview | <https://tafaqqah.onrender.com/admin> |
| Curriculum | Paths, levels, courses, chapters, and lessons | <https://tafaqqah.onrender.com/admin/curriculum> |
| Lessons | Lesson-level content management | <https://tafaqqah.onrender.com/admin/lessons> |
| Approved sources | Source registry and provenance | <https://tafaqqah.onrender.com/admin/sources> |
| Content review | Review and approval workflow | <https://tafaqqah.onrender.com/admin/review> |
| Matn management | Matn sections, passages, and units | <https://tafaqqah.onrender.com/admin/matn> |
| AI overview | Provider status and controlled trial surface | <https://tafaqqah.onrender.com/admin/ai> |
| Question traceability | Accepted/rejected candidates and evidence | <https://tafaqqah.onrender.com/admin/logs> |
| Learning analytics | Learner/content aggregates | <https://tafaqqah.onrender.com/admin/analytics> |
| AI evaluation | Pre/post and fixed-vs-adaptive evaluation | <https://tafaqqah.onrender.com/admin/evaluation> |
| Students | Learner progress records | <https://tafaqqah.onrender.com/admin/students> |
| Audit log | Consequential admin actions | <https://tafaqqah.onrender.com/admin/audit> |
| AI settings | AI status and approval rules without secrets | <https://tafaqqah.onrender.com/admin/settings> |

## Recommended Judging Path

1. Experience a learner lesson and baseline assessment.
2. Trigger or inspect review/reassessment for a weak concept.
3. Try memorization: local recording, self-assessment, review schedule, and reinforcement.
4. Sign in as Judge Admin.
5. Inspect the source and content-review state behind learner content.
6. Inspect AI overview and logs; compare displayed and rejected candidates.
7. Inspect evaluation, analytics, and audit history.

## What Judges Should Look For

### Source grounding

The server—not the browser—resolves the concept and source passage. Only passages marked approved and unchanged since approval are eligible for AI generation. Editing source text revokes usable approval.

### Traceability

Each generated candidate records lesson, concept, source passage, source version, source snapshot, generator metadata, deterministic findings, validator result, and display status. Admin logs show accepted and rejected candidates without storing private model chain-of-thought.

### Fail-closed safety

If source resolution is insufficient, output is malformed, validation rejects it, or the provider fails/times out, no fabricated question is displayed. Progress remains; fixed baseline assessment remains available.

### Independent validation

Generator and validator are separate model calls. Before model validation, deterministic server checks enforce structure, evidence, grounding, novelty, source-safe wording, and option quality. A candidate is served only after all required checks pass.

### Human-governed content

Admin workflows manage source passages, video timestamps, fixed questions, lesson publication, Matn units, and audit events. AI cannot approve sources, write trusted timestamps, or publish content.

### Guided active recall

Learners self-identify incorrect/forgotten words or full units. The application schedules review deterministically. The optional coach is restricted to bounded forms including cloze recall, context recall, reduced cues, sequence recall, delayed recall, and whole-unit recall.

## AI Question Pipeline

```text
Approved source passage
        ↓
Concept and assessment context
        ↓
Structured question generation
        ↓
Deterministic server checks
        ↓
Independent structured validator
        ↓
Server verification and persistence
        ↓
Displayed to learner / Rejected and never displayed
```

The system records structured outcomes and validation reasons, including successful, rejected, insufficient-source, malformed-output, and provider-error paths. It stores no private model reasoning.

Reliability controls:

- Candidates are persisted before serving, with a generation lock to avoid duplicate concurrent generation.
- Answer submission is idempotent: a duplicate request returns the stored answer.
- The client requests the persisted next state rather than treating a lost response as proof of failure.
- Generation has bounded retries and a per-question wall-clock budget; it fails closed when exhausted.

## Evaluation

The [AI evaluation page](https://tafaqqah.onrender.com/admin/evaluation) implements lesson-level pre/post measurement and fixed-versus-adaptive comparison. It presents collected records only; it does not manufacture outcome claims. The admin-only API export is `/api/admin/evaluation`.

## Current Product Scope

- **Understanding:** one lesson is currently published with approved source passages, approved review timestamps, and a fixed question bank. A second lesson is draft and not learner-published.
- **Memorization:** only approved Matn sections, passages, and units are learner-visible; draft content remains hidden.
- **Roadmap:** future levels may appear as roadmap stages, not as learner-openable content.
- **Impact:** mastery and pre/post measurement mechanisms are implemented. No completed comparative learning study or measured learning-improvement claim is made.

## Production Status

This repository includes type checking, linting, Prisma schema validation, Vitest suites, and Playwright specifications. Use the exact checkout/environment under review to obtain current results:

```bash
npm run typecheck
npm run lint
npx prisma validate
npm test
npm run test:e2e
npm run build
```

`npm test` uses `TEST_DATABASE_URL`, which must be separate because integration tests clear test tables. Playwright is configured for desktop (1366×900) and mobile (390×844). Use command or CI output for a passing count; this README does not manufacture one.

## Technical Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS 4
- PostgreSQL with Prisma 7 and `@prisma/adapter-pg`
- Zod request and AI-output schemas
- Google Gen AI SDK (Gemini), plus Anthropic and development-only mock implementations
- Custom email/password authentication with scrypt hashes and hashed server-side sessions
- Vitest, Playwright, Dockerfile, Docker Compose, and `/api/health`

## Architecture

```text
Learner / Admin browser
        ↓
Next.js pages, server actions, and API routes
        ↓
Assessment + memorization services
        ↓                         ↓
PostgreSQL / Prisma          Configured AI provider
        ↓                         ↓
Approved source records      Structured output + validation
```

The browser submits identifiers and option selections. Source retrieval, authorization, grading, mastery updates, approval checks, and AI calls run on the server.

## Safety, Security, and Privacy

- Server-side authorization protects pages, actions, and route handlers; non-admin users cannot access admin traceability surfaces.
- The client cannot supply an alternate source passage or answer key.
- Fixed questions are graded against stored keys. Mastery and review schedules are deterministic application rules.
- Source resolution requires approved, non-empty, unchanged text; otherwise it fails closed.
- AI keys are server-side environment variables and are not included in client bundles.
- Recitation audio remains a local browser Blob: it is not uploaded, stored, transcribed, or sent to AI.
- The system logs structured outputs, verdicts, and permitted diagnostics—not private reasoning.

## Local Development

Requirements: Node.js 20.9+ (Node 22 recommended), npm, and PostgreSQL 17 (or Docker).

### Environment variables

Copy the template, then edit `.env`:

```bash
cp .env.example .env
# Windows PowerShell: Copy-Item .env.example .env
```

| Variable | Needed for | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `npm run dev` with your own PostgreSQL | Ignored by Docker Compose, which builds its own. |
| `POSTGRES_PASSWORD` | Docker Compose | Any local value; never leaves your machine. |
| `TEST_DATABASE_URL` | `npm test` | **Must be a separate database** — the integration tests empty it. The tests refuse to run if it equals `DATABASE_URL`. |
| `AI_PROVIDER` + `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` | AI features | Optional; see below. |

Every other variable in [.env.example](.env.example) is optional and documented there.

**AI keys.** Use your own key: Gemini from [Google AI Studio](https://aistudio.google.com/apikey) (`AI_PROVIDER="gemini"`), or Anthropic from the [Claude Console](https://console.anthropic.com/settings/keys) (`AI_PROVIDER="anthropic"`). The production keys of the live demo are set only in the host's environment; they are not in this repository, and `.env` is git-ignored.

**Running without an AI key** works. The app reports AI as not configured and never fakes AI output: the understanding test uses the human-approved question bank, AI follow-up questions and targeted re-checks are skipped, and memorization reinforcement uses its deterministic fallback exercises. `AI_PROVIDER="mock"` is a development-only provider and is refused when `NODE_ENV=production`.

### Option A — everything in Docker Compose

Set `POSTGRES_PASSWORD` (and optionally an AI key) in `.env`, then:

```bash
docker compose up --build
```

This starts PostgreSQL, applies migrations, seeds the content on the first start of an empty database, and serves the app at <http://localhost:3000> (`APP_PORT` changes the port). The Compose database is not published on a host port, so it is not reachable from `npm run dev` or `npm test`.

### Option B — Node.js with your own PostgreSQL

Create two databases (for example `tafaqqah` and `tafaqqah_test`), point `DATABASE_URL` and `TEST_DATABASE_URL` at them, then:

```bash
npm install
npm run db:deploy
npm run db:seed
npm run dev
```

Open <http://localhost:3000>.

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run db:deploy
npm run db:seed
```

See [.env.example](.env.example), [AI architecture](docs/AI_ARCHITECTURE.md), [deployment](docs/DEPLOYMENT.md), and [attribution](docs/ATTRIBUTION.md).

## Project Structure

```text
src/app/          App Router pages, layouts, handlers, and server actions
src/server/       assessment, AI, auth, admin, memorization, and database services
src/components/   learner, memorization, admin, and UI components
prisma/           schema, migrations, seed, and seed data
content/          canonical Matn and content-processing inputs
tests/            Vitest unit/integration suites
e2e/              Playwright browser specifications
docs/             architecture, deployment, and attribution
```

## Links

- Live product: <https://tafaqqah.onrender.com/>
- GitHub: <https://github.com/hala-devs/tafaqqah>
- Methodology: <https://tafaqqah.onrender.com/methodology>

## License

The project code is available under the [MIT License](LICENSE). Third-party source texts and videos remain subject to their own rights; see [Attribution](docs/ATTRIBUTION.md).
