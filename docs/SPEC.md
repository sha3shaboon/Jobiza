# Jobiza — AI Research Assistant (Claude-powered)

Inspired by Anara (formerly Unriddle): turn a researcher's papers into a queryable,
citation-grounded knowledge base, then help them discover literature and write with
every claim traced to a source.

## Decisions (from grill-me session)

| Area | Decision |
|---|---|
| Audience | Students & academics |
| Scope | All three pillars, complete: Library chat, Literature review builder, Cited writing editor |
| Platform | Web app first; clean API layer so desktop & mobile clients can follow |
| Stack | Next.js + TypeScript, Postgres + pgvector, Redis-backed job worker |
| AI costs | Bring-your-own Anthropic key (stored encrypted per user) |
| Model | Single user-selected Claude model in settings, used everywhere |
| Retrieval | Local open-source embeddings + Postgres full-text (hybrid); answers via Claude Citations |
| Inputs | PDFs, DOI/URL import, web articles; scanned pages OCR'd via Claude vision |
| Discovery sources | Semantic Scholar, OpenAlex, arXiv, PubMed/PMC, Unpaywall (OA PDFs) |
| Review modes | (1) Agentic deep research — background job, cited synthesis + comparison matrix; (2) Rigorous screening — include/exclude criteria, PRISMA-style log |
| Writing | CSL citation styles (citation-js), Zotero/BibTeX import & export, DOCX/PDF/LaTeX export, claim checker |
| Collaboration | Solo libraries now; schema ready for workspaces |
| Auth | Email magic link, Google, ORCID, email+password |
| Hosting | Docker Compose (web + worker + Postgres/pgvector + Redis) |

## Build phases

1. ✅ **Foundation** — Compose stack, DB schema, auth (all 4 methods), encrypted BYOK settings, model picker.
2. **Library + chat** — PDF/DOI/URL ingest, parsing + vision OCR, chunking, local embeddings, hybrid search, cited chat with page-level source highlighting in a PDF viewer.
3. **Literature review** — source connectors, agentic deep-research job with progress streaming, screening mode + PRISMA log, comparison matrix.
4. **Writing editor** — rich-text editor with inline citations, CSL styles, Zotero/BibTeX, claim checker, DOCX/PDF/LaTeX export.
5. **Polish** — public API docs for future desktop/mobile clients, tests, deployment guide.

## Brand

- **Name:** Jobiza, from خُبَّيْزَة (*khubbayza*, *Malva parviflora*, cheeseweed), the wild mallow that comes up on its own after the rains. The Arabic name is shown beside the wordmark.
- **Idea:** a self-growing library. You plant your sources and your research grows from them. The landing-page stages are Plant (library), Spread (literature review) and Harvest (writing).
- **Logo:** the "jobiza" wordmark in Fraunces, with a flat five-petal mallow blossom as the dot of the i. خُبَّيْزَة is set beside it (headers, nav) or underneath it, under "za" (landing, sign-in). The blossom on its own is the app icon. Source: `src/components/logo.tsx` (`Wordmark`, `Blossom`, `Logo` with `inline` / `stacked` layouts) and `src/app/icon.svg`.
- **Design direction:** "After the rain, in the margins." Field green frames the product (landing hero, app sidebar, sign-in panel). White is for reading. Answers highlight cited claims and trace them to notes in a margin column, and settings use the same explanation-in-the-margin layout.
- **Palette:** field green `#21402C` (brand chrome, primary action on white), blossom `#F3B6CE` (actions on green), highlighter `#F6CADC` and citation pink `#B8467A` (evidence), ink `#1B1E24` on white. Tokens and the `.on-field` scope live in `src/app/globals.css`.
- **Type:** Readex Pro for all interface and reading text (Latin and Arabic in one family), on a 1.25 scale. Fraunces and Noto Naskh Arabic appear only in the logo.
- **Illustration:** grainy, flat, hand-cut print style with characterful research objects (books, a highlighter, a magnifying glass with an eye, a highlighted paper, a potted khubbayza in bloom) and loose doodles. Files: `public/illustrations/research-shelf.svg` (hero, sign-in) and `sprout-pot.svg` (empty states). Grain on brand surfaces uses the `.grain` class.
- **Motion:** no decorative motion beyond the illustrations; everything respects `prefers-reduced-motion`.
