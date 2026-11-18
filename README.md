# Jobiza

An AI research assistant for students and academics, powered by Claude. Chat with your papers, build
literature reviews and write with every claim cited. Users bring their own Anthropic API key.

See [`docs/SPEC.md`](docs/SPEC.md) for the product decisions and the phased build plan.

## Status

| Phase | Scope | State |
|---|---|---|
| 1. Foundation | Docker stack, DB schema, auth (magic link, password, Google, ORCID), encrypted BYOK, model picker, worker | ✅ done |
| 2. Library + chat | PDF/DOI ingest, OCR, local embeddings, hybrid search, cited chat | next |
| 3. Literature review | Source connectors, agentic + screening modes, PRISMA log, matrix | planned |
| 4. Writing editor | CSL citations, Zotero/BibTeX, claim checker, DOCX/PDF/LaTeX export | planned |
| 5. Polish | API docs for desktop/mobile clients, deploy guide | planned |

## Run it with Docker (recommended)

```bash
cp .env.example .env
npm run gen:secrets          # paste both values into .env (needs Node locally)
docker compose up --build
```

- App: http://localhost:3000
- Mailpit (catches magic-link and verification emails): http://localhost:8025

Compose starts Postgres 17 with pgvector, Redis, Mailpit, a one-shot `migrate` job, the web app and the worker.

## Run it locally (for development)

You need Node 22, Postgres 16+ with the `vector` extension, and Redis.

```bash
npm install
cp .env.example .env.local   # fill in secrets with: npm run gen:secrets
npm run db:migrate
npm run dev                  # web, http://localhost:3000
npm run worker:dev           # background worker, in a second terminal
```

With `SMTP_URL` empty, emails are printed to the web server console.

## Sign-in providers

Email/password and magic links work out of the box. Google and ORCID buttons appear only when their credentials are set:

| Provider | Where to register | Redirect URI |
|---|---|---|
| Google | Google Cloud Console → Credentials | `{BETTER_AUTH_URL}/api/auth/callback/google` |
| ORCID | orcid.org/developer-tools (use `ORCID_BASE_URL=https://sandbox.orcid.org` for testing) | `{BETTER_AUTH_URL}/api/auth/oauth2/callback/orcid` |

ORCID usually doesn't share email addresses, so ORCID accounts are keyed on the ORCID iD.

## How API keys are handled

- A key is checked with Anthropic's Models API, which costs nothing, before it is saved.
- It is stored AES-256-GCM encrypted with `ENCRYPTION_KEY`, bound to its user ID. Only the last 4 characters are kept readable, for display.
- The decrypted key never leaves the server. The model list comes from the user's own key, so the picker only shows models that key can use.

Rotating `ENCRYPTION_KEY` makes stored keys unreadable, so users would have to re-enter them.

## API (for future desktop and mobile clients)

Every endpoint accepts a session cookie or `Authorization: Bearer <token>`. The token comes from the `set-auth-token` header on sign-in.

| Method | Path | Purpose |
|---|---|---|
| `*` | `/api/auth/*` | Better Auth (sign-up, sign-in, magic link, OAuth, sign-out) |
| GET | `/api/v1/me` | Current user, personal workspace and settings |
| GET / PATCH | `/api/v1/settings` | Read or update `model` and `citationStyle` |
| PUT / DELETE | `/api/v1/settings/api-key` | Verify and save, or remove, the Anthropic key |
| GET | `/api/v1/models` | Claude models available to the user's key |

## Project layout

```
src/app/            Next.js routes (pages + /api)
src/components/     UI components
src/db/             Drizzle schema + client
src/lib/            env, auth, crypto, Anthropic, email
src/server/         server-only services (settings, sessions, workspaces)
worker/             BullMQ background worker
drizzle/            SQL migrations
```

## Scripts

`npm run typecheck` · `npm run lint` · `npm test` (DB integration tests run when `DATABASE_URL` is set) ·
`npm run db:generate` (new migration from schema changes) · `npm run db:migrate`
