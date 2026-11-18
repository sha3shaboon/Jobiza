# Jobiza

**Jobiza · خُبَّيْزَة**: plant your sources, watch your research grow.

An AI research assistant for students and academics, powered by Claude. Chat with your papers, build
literature reviews and write with every claim cited. Users bring their own Anthropic API key.

See [`docs/SPEC.md`](docs/SPEC.md) for the product decisions and the phased build plan.

## Status

| Phase | Scope | State |
|---|---|---|
| 1. Foundation | Docker stack, DB schema, auth (magic link, password, Google, ORCID), encrypted BYOK, model picker, worker | ✅ done |
| 2. Library + chat | PDF/DOI/URL ingest, OCR, local embeddings, hybrid search, cited chat, PDF viewer | ✅ done |
| 3. Literature review | Source connectors, agentic + screening modes, PRISMA log, matrix | ✅ done |
| 4. Writing editor | CSL citations, Zotero/BibTeX, claim checker, DOCX/PDF/LaTeX export | ✅ done |
| 5. Polish | API docs for desktop/mobile clients, deploy guide | next |

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

## How the library and chat work

1. **Add a source** (Library page or `POST /api/v1/papers`): upload a PDF, or import a DOI or link.
   - DOIs: metadata from OpenAlex and Crossref; the open-access PDF (Unpaywall data via OpenAlex) is fetched when there is one, otherwise the abstract is indexed.
   - Links: PDFs are downloaded; web pages are turned into readable text, and scholarly pages that link a `citation_pdf_url` get the real PDF.
   - Every server-side fetch goes through an SSRF guard (public addresses only, checked on each redirect, 50 MB and 30 s limits).
2. **The worker processes it**: text is extracted page by page; scanned pages are read by Claude with the owner's key (up to 60 pages per paper); the DOI (or arXiv id) on the first pages fills in title, authors and year.
3. **Indexing**: each page is split into overlapping passages that never cross a page, embedded locally with `bge-small-en-v1.5` (no API cost), and stored with a full-text index.
4. **Asking**: hybrid search (pgvector similarity + Postgres full-text, merged with reciprocal rank fusion) picks passages from the whole library or the papers you choose. They are sent to Claude as `search_result` blocks, one sentence per block, so Claude cites exact sentences. Each citation is stored with paper, page and quote.
5. **Checking**: citations in the margin open the PDF at the cited page with the passage highlighted.

The embedding model (about 35 MB) downloads on first use into `MODEL_CACHE_DIR`.

## How literature reviews work

A review starts from a research question, in one of two modes:

- **Research it for me (agentic)**: Claude plans 3 to 6 queries and the criteria, Jobiza searches every source, Claude screens up to 200 records by title and abstract, the 10 most relevant are read (full text when open access, else the abstract), a comparison table is filled from each study's text, and a synthesis is written that cites the passages it used.
- **I'll screen the papers (screening)**: you set queries, sources, years, criteria and table columns (Claude can suggest them), run the search, and include or exclude each record. Claude can suggest decisions, but they apply only when you accept them. Then you get the included studies, fill the table and write the synthesis, one step at a time.

Details:

- **Sources**: OpenAlex, Semantic Scholar, arXiv and PubMed (25 results per query per source). Results are merged across sources by DOI, PMID, arXiv id or title, and duplicates are counted for PRISMA.
- **Rate limits**: without API keys, OpenAlex, Semantic Scholar and arXiv share a small budget per IP address. A busy source is skipped and noted in the review, and the rest carry on. Free keys are in `.env.example`.
- **Full text**: included studies are added to your library. PMC articles come from Europe PMC's open full-text API. When a publisher blocks the download, the abstract is used and the reason is shown.
- **Audit trail**: the PRISMA tab shows identification, screening (with exclusion reasons), retrieval and inclusion counts plus an activity log. The screening log downloads as CSV, with every decision, who made it (you or Claude) and why.

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

## How the writing editor works

Documents are rich text (TipTap) with citations stored as inline nodes that point at papers in your library, with an optional page. The labels and the reference list are generated live in the chosen style, so switching style re-numbers and reformats everything.

- **Citation styles**: APA 7, MLA 9, Chicago (author-date), IEEE, Vancouver and Harvard (Cite Them Right). The CSL files are vendored in `src/lib/writing/csl/` (CC BY-SA, from the Citation Style Language project) and rendered with citation-js, so numbering follows first use and same-author-same-year works are disambiguated.
- **Draft with Claude**: Claude writes the passage you ask for from your library only, and every claim comes back as a real citation node with the page it used. You can limit it to chosen papers.
- **Claim checker**: each sentence of five or more words (up to 40 per run) is checked against passages from the papers it cites. Uncited sentences are matched against your library and flagged as needing a citation when a passage supports them, with a one-click "Add this citation". Every evidence quote is matched against the stored source text before it's shown. If Claude's quote can't be found, the verdict becomes "Couldn't verify" instead of "Supported".
- **References in**: import BibTeX, RIS or CSL-JSON files (Zotero, Mendeley, EndNote exports), or pull a Zotero library or collection with a read-only API key. The key is used once and never stored. References with a DOI fetch open-access full text when available; the rest are indexed by abstract, or kept as cite-only entries. Duplicates are skipped by DOI, or by title and year.
- **Export**: Word (.docx), PDF, LaTeX (a zip with `main.tex` using biblatex in the matching style, and `references.bib`), Markdown, or just the BibTeX of the cited papers.

## API (for future desktop and mobile clients)

Every endpoint accepts a session cookie or `Authorization: Bearer <token>`. The token comes from the `set-auth-token` header on sign-in.

| Method | Path | Purpose |
|---|---|---|
| `*` | `/api/auth/*` | Better Auth (sign-up, sign-in, magic link, OAuth, sign-out) |
| GET | `/api/v1/me` | Current user, personal workspace and settings |
| GET / PATCH | `/api/v1/settings` | Read or update `model` and `citationStyle` |
| PUT / DELETE | `/api/v1/settings/api-key` | Verify and save, or remove, the Anthropic key |
| GET | `/api/v1/models` | Claude models available to the user's key |
| GET / POST | `/api/v1/papers` | List papers; upload a PDF (multipart, field `file`) |
| POST | `/api/v1/papers/import` | Import `{ "input": "<DOI or link>" }` |
| GET / DELETE | `/api/v1/papers/:id` | Paper details; delete |
| POST | `/api/v1/papers/:id/retry` | Re-run processing |
| GET | `/api/v1/papers/:id/file` | The PDF |
| GET | `/api/v1/papers/:id/pages/:n` | Extracted text of a page or section |
| GET / POST | `/api/v1/conversations` | List; start one (`scopePaperIds` optional) |
| GET / PATCH / DELETE | `/api/v1/conversations/:id` | Messages with citations; change scope; delete |
| POST | `/api/v1/conversations/:id/messages` | Ask `{ "question": "…" }`; streams Server-Sent Events: `sources`, `text`, then `done` or `error` |
| GET / POST | `/api/v1/reviews` | List; start `{ question, mode: "agentic" \| "screening" }` |
| GET / PATCH / DELETE | `/api/v1/reviews/:id` | Review with records, PRISMA counts and log; edit queries, criteria, sources, columns |
| POST | `/api/v1/reviews/:id/plan` | Claude suggests queries, criteria and columns |
| POST | `/api/v1/reviews/:id/steps` | Queue `{ step: "run" \| "search" \| "ai-screen" \| "retrieve" \| "extract" \| "synthesize" }` |
| PATCH | `/api/v1/reviews/:id/records/:recordId` | Screening decision `{ screening, reason? }` |
| POST | `/api/v1/reviews/:id/accept-suggestions` | Apply Claude's suggestions to undecided records |
| GET | `/api/v1/reviews/:id/export` | Screening log as CSV |
| POST | `/api/v1/papers/import-references` | Import a BibTeX, RIS or CSL-JSON file (multipart, field `file`) |
| POST | `/api/v1/papers/import-zotero` | Import `{ libraryType: "user" \| "group", libraryId, apiKey, collectionKey? }` |
| GET / POST | `/api/v1/documents` | List; create `{ title? }` |
| GET / PATCH / DELETE | `/api/v1/documents/:id` | Document; save `{ title?, content?, citationStyle? }`; delete |
| POST | `/api/v1/documents/:id/draft` | Claude drafts `{ instruction, scopePaperIds? }`; returns document nodes with citations |
| POST | `/api/v1/documents/:id/check` | Run the claim checker; returns and saves the checks |
| GET | `/api/v1/documents/:id/export?format=` | `docx`, `pdf`, `latex` (zip), `markdown` or `bibtex` |
| POST | `/api/v1/citations/render` | Labels and bibliography for `{ content, style }` |

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

## Claude Code skills in this repo

`.claude/skills/` holds the UI/UX skills from
[Snyk's list of top Claude skills for UI/UX engineers](https://snyk.io/articles/top-claude-skills-ui-ux-engineers/).
They load automatically in Claude Code sessions opened on this repository:

| Skill | From |
|---|---|
| `frontend-design` | anthropics/skills |
| `web-design-guidelines`, `react-best-practices`, `composition-patterns`, `react-native-skills` | vercel-labs/agent-skills |
| `ui-ux-pro-max` | nextlevelbuilder/ui-ux-pro-max-skill |
| `bencium-innovative-ux-designer`, `bencium-controlled-ux-designer` | bencium/bencium-claude-code-design-skill |

Each folder's `SOURCE.md` records the upstream commit, licence and any local changes.

The **AccessLint** accessibility plugin is registered in `.claude/settings.json`. It loads when the repository is
opened in Claude Code on your computer, after you trust the folder. It does not load in cloud sessions. Its MCP server
runs `npx @accesslint/mcp@latest`.
