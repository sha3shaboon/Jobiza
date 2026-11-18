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

1. **Foundation** — Compose stack, DB schema, auth (all 4 methods), encrypted BYOK settings, model picker.
2. **Library + chat** — PDF/DOI/URL ingest, parsing + vision OCR, chunking, local embeddings, hybrid search, cited chat with page-level source highlighting in a PDF viewer.
3. **Literature review** — source connectors, agentic deep-research job with progress streaming, screening mode + PRISMA log, comparison matrix.
4. **Writing editor** — rich-text editor with inline citations, CSL styles, Zotero/BibTeX, claim checker, DOCX/PDF/LaTeX export.
5. **Polish** — public API docs for future desktop/mobile clients, tests, deployment guide.
