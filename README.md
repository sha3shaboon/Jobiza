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
| Desktop (Windows) | The whole app on one computer: embedded database, local jobs, no server | ✅ done |
| Android | The whole app on the phone, same features, works offline | ✅ done |
| Device sync | Paired desktops and phones swap changes on the same network, end-to-end encrypted | ✅ done |
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

## Desktop app (Windows)

The desktop app is the complete Jobiza (library, chat, literature reviews and writing) running on your own computer. There is no server to host and no account to create. Your PDFs, library and documents stay on disk; only Claude (with your own key) and paper searches go online.

**Install:** download `Jobiza-Setup-<version>.exe` from the latest [release](../../releases) (or the *Jobiza-Windows-installer* artifact of the latest *Desktop app (Windows)* workflow run), then run it. The installer isn't code-signed yet, so Windows SmartScreen will warn you the first time: choose *More info*, then *Run anyway*. Windows 10 or 11, x64.

**Where things live:**

- Library, database and uploaded PDFs: `%APPDATA%\Jobiza\library` (Help → *Show library folder*). Uninstalling keeps it.
- Log file: `%APPDATA%\Jobiza\logs\jobiza.log` (Help → *Show log file*).
- Secrets made on first run (the key that encrypts your Anthropic key, and the local account's password) are stored in `%APPDATA%\Jobiza\secrets.json`, encrypted with Windows DPAPI so only your Windows account can read them.

**How it works:** the Electron shell (`desktop/main.cjs`) starts the same Next.js server as the web build in a background process, on `127.0.0.1` with a random port, and opens it in a window. With `JOBIZA_DESKTOP=1`, the server:

- uses an embedded Postgres ([PGlite](https://pglite.dev), WebAssembly) with pgvector and pg_trgm instead of a Postgres server. The schema and every query are the same; migrations are applied at start-up (`src/server/desktop.ts`);
- runs ingestion and review steps in-process (`src/server/local-queue.ts`) instead of BullMQ and Redis. Papers that were processing when the app closed are resumed on the next launch. Review steps that were cut off are marked for a re-run, because they spend Claude credits;
- signs the window in to a single local account through `/api/desktop/session`, using a secret that changes every launch. There's no sign-in page, sign-out or email;
- ships the embedding model inside the installer, so the library works offline from the first launch.

On quit, the shell asks the server to close the database cleanly before exiting.

**Build it yourself (on Windows):**

```bash
npm ci && npm run build          # the web app, as a standalone server
cd desktop
npm ci
npm run dist:win                 # → desktop/dist/Jobiza-Setup-<version>.exe
node scripts/smoke.cjs dist/win-unpacked/Jobiza.exe   # optional end-to-end check
```

Build on the OS you're targeting: the server's native modules (ONNX runtime, sharp) are picked for the build machine. CI does this on `windows-latest` and runs the smoke test (launch, add a PDF, wait until it's processed, quit cleanly) before uploading the installer. `npm start` in `desktop/` runs the shell against `desktop/build/` for development.

**Not yet:** macOS and Linux installers, code signing, automatic updates, and moving a library between the desktop app and a server.

## Android app

The complete Jobiza on your phone: library, chat, literature reviews and writing. Like the desktop app, it keeps its own library on the device and needs no server. Pair it with the desktop app to keep both in sync (see below).

**Install:** download the `.apk` from the latest [release](../../releases) (or the **Jobiza-Android-phone-arm64** artifact of the latest *Android app* workflow run) and open it on the phone. Android asks you to allow installs from that source the first time. Android 8 or newer, 64-bit (almost every phone from 2017 on). The first launch unpacks the app (about 30 seconds); after that it opens in a few seconds.

**On the phone:**

- **Share to Jobiza**: in any app, share a PDF, a link or a DOI to *Add to Jobiza*. It lands in your library and is processed like an upload.
- **Exports** (Word, PDF, LaTeX, BibTeX) are saved to *Downloads/Jobiza* and open in the app you choose.
- The back button goes back through pages; at the top it sends Jobiza to the background instead of closing it, so jobs keep running while Android lets them.
- Android pauses background apps after a while. A literature review step that's interrupted that way can be run again from the review.

**How it works:** it's the same Next.js server as the desktop app, running on the phone. Node.js 24 comes from [Termux](https://termux.dev)'s Android packages: `mobile/scripts/prepare-runtime.mjs` downloads them, checks their SHA-256 against Termux's index, and re-links them with patchelf so Android can install them as native libraries. The two packages with no Android build are replaced: embeddings run on the WebAssembly build of the ONNX runtime (results match the native runtime to about 0.999 cosine similarity, so vectors from either can be mixed), and the image library isn't needed. The Capacitor shell (`mobile/android/…/JobizaServer.java`) unpacks the server on first launch, keeps its secrets with the Android Keystore, starts Node on 127.0.0.1, and shows the app in a WebView. Data lives in the app's private storage; uninstalling removes it, so pair with a desktop first if you want a copy.

**Build it yourself:**

```bash
npm ci && npm run build                 # the web app, as a standalone server
cd mobile && npm ci && pip install patchelf
npm run prepare-server && npm run prepare-runtime && npm run prepare-assets
npx cap sync android
cd android && ./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
```

You need Java 21 and the Android SDK (platform 36). CI builds both APKs (arm64 for phones, x86_64 for emulators and Chromebooks) and runs `mobile/scripts/emulator-smoke.sh` on an Android 14 emulator: launch, wait for the server, add a PDF the way *Share to Jobiza* does, wait until it's processed, share a link, and check nothing crashed.

**Signing:** Android only updates an installed app with an APK signed by the same key. Without a key, CI publishes a debug build (`…-debug.apk`), which later releases can't update in place. To sign releases, create a key once and add it to the repository's *Settings → Secrets and variables → Actions*:

```bash
keytool -genkeypair -v -keystore jobiza.keystore -alias jobiza -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 jobiza.keystore   # → secret ANDROID_KEYSTORE_BASE64
```

Also add `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`jobiza`) and `ANDROID_KEY_PASSWORD`. Keep the keystore file somewhere safe: losing it means users must reinstall to get updates.

**Not yet:** a Play Store listing, iOS, and keeping long jobs alive in the background with a notification.

## Updates

The desktop and Android apps update themselves from this repository's GitHub releases. *Settings → Updates* shows the version, a switch for automatic updates (on by default) and *Check for updates*.

- **Windows** uses electron-updater (`desktop/updater.cjs`): it reads `latest.yml` from the latest release, downloads the installer in the background, checks its SHA-512, and installs it when Jobiza closes, after the server has closed its database. A notification and an in-app banner offer *Restart and update*. With automatic updates off it only checks when asked (*Settings → Updates* or *Help → Check for updates…*).
- **Android** (`Updater.java`) checks the GitHub API for the latest release, downloads the signed phone APK on Wi-Fi, verifies it against the release's `SHA256SUMS.txt`, and hands it to Android's installer, which asks you to confirm and only accepts an APK signed with the same key. Debug builds say they can't update themselves.
- Pages reach these controls through a small bridge (`window.jobizaUpdates` on desktop, `window.JobizaAndroid` on Android) that only answers Jobiza's own pages.

Releases must be regular releases (not pre-releases) to be offered as updates.

## Releases

Pushing a version tag (`git tag v0.1.0 && git push origin v0.1.0`), or running the *Release* workflow from the Actions tab with a version number, runs `.github/workflows/release.yml`: it builds and smoke-tests the Windows and Android apps, then publishes a GitHub release with the installer and its update files (`latest.yml`, blockmap), the phone APK and `SHA256SUMS.txt`, using `docs/releases/<tag>.md` as the notes. The tag must match the version in `desktop/package.json` and `mobile/package.json`.

## Syncing your devices

The desktop and Android apps each keep a complete library and work on their own, offline included. Pair them, and whenever both are open on the same Wi-Fi network they swap changes: papers (with their PDFs, text and search data, so the phone never re-processes them), chats, literature reviews, documents and proposals, and your model and citation-style choices.

**Pair:** on one device open *Settings → Devices and sync → Pair a new device*. It shows a QR code (and the same code as text) that works once, for 10 minutes. On the other device choose *Enter a pairing code*, then scan it with the camera or paste the text. You can also copy your Anthropic API key across at the same time.

**What to expect:**

- Sync runs every 45 seconds and straight away when a paired device appears on the network. *Sync now* does it on demand.
- If both devices edit the same thing, the more recent edit wins. Deleting on one device deletes on the others, unless it was edited afterwards.
- Work in progress waits: a paper still being processed, or a review step still running, syncs when it's done.
- The API key is never synced after pairing; each device stores its own copy encrypted with its own key.
- On Windows, the firewall asks once whether Jobiza may use the network: allow it on private networks.

**How it's built** (`src/server/sync/`): triggers give every write in the synced tables a change number and record deletes as tombstones (migration `0006_sync`). Each device asks each peer for "changes since N" and applies them with *newest edit wins*; rows whose parent hasn't arrived yet wait in `sync_pending`. The pairing code carries a fresh 32-byte key, and everything devices send each other is compressed and sealed with AES-256-GCM using it, so traffic is unreadable on the network and only a paired device can talk to another. Devices listen on TCP port 47310 and announce themselves with a small UDP broadcast on port 47311 so they find each other again after an address change.

**Not yet:** syncing across different networks (that needs a relay server) and more than one person sharing a library.

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
- **Reading the papers**: the *Papers* tab lists every record as soon as the search finds them, and keeps updating while Claude screens. Click any title (included, excluded or not yet screened) to open it in a reader panel: the abstract, Claude's screening note and table values, and links to the publisher, PubMed or arXiv. *Read the full text here* adds the paper to your library, fetches an open-access copy when there is one (otherwise the abstract), and shows the PDF in the panel. Reading a paper never changes its screening decision or the PRISMA counts.
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

## How research proposals work

*Writing → New research proposal*, or *Plan a research proposal from this review* on a review's synthesis.

1. **Your idea**: the kind of proposal (thesis or dissertation, grant, or study protocol and research plan), the topic, your research question if you have one, field, time frame, section length, and which papers to build on: the whole library, a literature review, or papers you pick.
2. **The plan**: Claude adapts the template for that kind of proposal to your topic. It suggests a working title, research questions, aims, and what each section should say, based on your library and, when linked, the review's synthesis and gaps. Edit any of it: rename, reorder, add or remove sections, and choose which ones cite the literature.
3. **Writing**: the proposal opens in the editor and Claude writes the sections one after another. Each section sees the plan and the sections before it. Claims about existing research cite passages from your library as real citation nodes. Never invented studies or numbers. Decisions only you can make (sample size, budget figures) are left in `[square brackets]`. The *Proposal* tab in the margin shows each section's status, lets you stop, and redrafts any section with an optional note ("shorter", "focus on qualitative methods").

A proposal is an ordinary document after that: cite, check claims, switch citation style and export to Word, PDF or LaTeX.

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
| POST | `/api/v1/reviews/:id/records/:recordId/read` | Add a found paper to the library and fetch its text for reading |
| POST | `/api/v1/proposals/plan` | Claude's outline for a brief `{ type, topic, question?, field?, timeframe?, length?, reviewId?, scopePaperIds? }` (nothing saved) |
| POST | `/api/v1/proposals` | Create a proposal document from `{ title, plan }` |
| POST | `/api/v1/documents/:id/proposal-section` | Claude writes one section `{ sectionId, priorText?, note? }`; returns document nodes with citations |

## Project layout

```
src/app/            Next.js routes (pages + /api)
src/components/     UI components
src/db/             Drizzle schema + client
src/lib/            env, auth, crypto, Anthropic, email
src/server/         server-only services (settings, sessions, workspaces)
worker/             BullMQ background worker
drizzle/            SQL migrations
desktop/            Electron shell, installer config and build scripts for the desktop app
mobile/             Android app: Capacitor shell, Node runtime and server packaging scripts
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
