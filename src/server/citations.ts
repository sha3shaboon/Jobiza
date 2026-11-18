import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
// citation-js ships CommonJS with side-effect plugin registration.
import { Cite, plugins } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-csl";
import "@citation-js/plugin-ris";
import type { PaperAuthor } from "@/db/schema";
import { normalizeDoi } from "@/lib/ingest/text";
import { collectCitations, type DocNode } from "@/lib/writing/doc";

/** Style ids offered in the app → vendored CSL files (see src/lib/writing/csl/README.md). */
export const STYLE_FILES: Record<string, string> = {
  apa: "apa.csl",
  "modern-language-association": "modern-language-association.csl",
  "chicago-author-date": "chicago-author-date.csl",
  ieee: "ieee.csl",
  vancouver: "vancouver.csl",
  "harvard-cite-them-right": "harvard-cite-them-right.csl",
};

const CSL_DIR = path.join(process.cwd(), "src/lib/writing/csl");
type CslConfig = {
  styles: { add(name: string, xml: string): void; has(name: string): boolean };
  locales: { add(name: string, xml: string): void; has(name: string): boolean };
  engine: (data: CslItem[], style: string, lang: string, format: string) => CiteprocEngine;
};
type CiteprocEngine = {
  rebuildProcessorState(citations: unknown[], mode?: string): [string, number, string][];
  makeBibliography(): [unknown, string[]] | false;
};

function config(): CslConfig {
  const cfg = plugins.config.get("@csl") as CslConfig;
  if (!cfg.locales.has("en-US")) cfg.locales.add("en-US", readFileSync(path.join(CSL_DIR, "locales-en-US.xml"), "utf8"));
  return cfg;
}

function styleName(style: string): string {
  const file = STYLE_FILES[style] ?? STYLE_FILES.apa;
  const name = `jobiza-${file.replace(/\.csl$/, "")}`;
  const cfg = config();
  if (!cfg.styles.has(name)) cfg.styles.add(name, readFileSync(path.join(CSL_DIR, file), "utf8"));
  return name;
}

/* ───────────── Papers ↔ CSL-JSON ───────────── */

export type CslItem = {
  id: string;
  type: string;
  title: string;
  author?: { family?: string; given?: string; literal?: string }[];
  issued?: { "date-parts": number[][] };
  "container-title"?: string;
  DOI?: string;
  URL?: string;
  "citation-key"?: string;
  abstract?: string;
};

type PaperForCitation = {
  id: string;
  title: string;
  authors: PaperAuthor[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  source: string;
};

export function splitName(name: string): { family?: string; given?: string; literal?: string } {
  const n = name.trim();
  if (!n) return { literal: "" };
  if (n.includes(",")) {
    const [family, given] = n.split(",", 2).map((s) => s.trim());
    return { family, given };
  }
  // Organisations ("WHO", "Wikimedia Foundation, Inc.") stay whole.
  if (!/\s/.test(n) || /\b(inc|ltd|foundation|organization|organisation|university|institute|group|consortium|committee)\b/i.test(n)) return { literal: n };
  const parts = n.split(/\s+/);
  return { family: parts.at(-1), given: parts.slice(0, -1).join(" ") };
}

export function paperToCsl(p: PaperForCitation, key?: string): CslItem {
  return {
    id: p.id,
    type: p.source === "url" && !p.doi ? "webpage" : "article-journal",
    title: p.title,
    author: p.authors.map((a) => splitName(a.name)),
    issued: p.year ? { "date-parts": [[p.year]] } : undefined,
    "container-title": p.venue ?? undefined,
    DOI: p.doi ?? undefined,
    URL: p.doi ? undefined : (p.url ?? undefined),
    "citation-key": key,
  };
}

/* ───────────── Rendering ───────────── */

export type RenderedCitations = {
  /** In-text label per citation node id. */
  labels: Record<string, string>;
  /** Bibliography entries as HTML (for the editor) and plain text (for exports). */
  bibliography: { html: string; text: string }[];
};

/**
 * Format every citation in a document in reading order, so numeric styles
 * number by first use and author-date styles disambiguate (2017a, 2017b).
 */
export function renderCitations(doc: DocNode, style: string, papers: PaperForCitation[]): RenderedCitations {
  const byId = new Map(papers.map((p) => [p.id, p]));
  const clusters = collectCitations(doc)
    .map((c) => ({ ...c, items: c.items.filter((i) => byId.has(i.paperId)) }))
    .filter((c) => c.items.length);
  if (!clusters.length) return { labels: {}, bibliography: [] };

  const items = [...new Set(clusters.flatMap((c) => c.items.map((i) => i.paperId)))].map((id) => paperToCsl(byId.get(id)!));
  const name = styleName(style);
  const cfg = config();
  const citationObjects = clusters.map((c) => ({
    citationID: c.id,
    citationItems: c.items.map((i) => (i.locator ? { id: i.paperId, locator: i.locator, label: "page" } : { id: i.paperId })),
    properties: { noteIndex: 0 },
  }));

  // citation-js caches one engine per style: finish all text output before switching to HTML.
  const labels: Record<string, string> = {};
  const engine = cfg.engine(items, name, "en-US", "text");
  for (const [id, , label] of engine.rebuildProcessorState(citationObjects, "text")) labels[id] = decodeEntities(label);
  const textBib = [...((engine.makeBibliography() || [null, []])[1] as string[])];

  const htmlEngine = cfg.engine(items, name, "en-US", "html");
  htmlEngine.rebuildProcessorState(citationObjects, "html");
  const html = [...((htmlEngine.makeBibliography() || [null, []])[1] as string[])];
  return {
    labels,
    bibliography: html.map((h, i) => ({ html: sanitizeBibHtml(h), text: decodeEntities((textBib[i] ?? "").trim()) })),
  };
}

function decodeEntities(s: string) {
  return s
    .replace(/&#38;|&amp;/g, "&")
    .replace(/&#60;|&lt;/g, "<")
    .replace(/&#62;|&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** citeproc output is trusted markup, but titles come from users and imports: keep only formatting tags. */
export function sanitizeBibHtml(html: string): string {
  return html
    .replace(/<(?!\/?(?:div|i|b|span|sup|sub)\b)[^>]*>/gi, "")
    .replace(/<(div|i|b|span|sup|sub)\b([^>]*)>/gi, (_m, tag: string, attrs: string) => {
      const cls = attrs.match(/class="(csl-[a-z-]+)"/i)?.[1];
      return `<${tag}${cls ? ` class="${cls}"` : ""}>`;
    })
    .trim();
}

/* ───────────── BibTeX ───────────── */

/** Stable, unique BibTeX keys: Surname + year + first title word. */
export function bibtexKeys(papers: PaperForCitation[]): Map<string, string> {
  const used = new Map<string, number>();
  const keys = new Map<string, string>();
  for (const p of papers) {
    const surname = (splitName(p.authors[0]?.name ?? "").family ?? splitName(p.authors[0]?.name ?? "").literal ?? "anon")
      .normalize("NFKD")
      .replace(/[^A-Za-z]/g, "");
    const word = (p.title.match(/[A-Za-z]{4,}/)?.[0] ?? "paper").toLowerCase();
    const base = `${surname || "anon"}${p.year ?? "nd"}${word}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    keys.set(p.id, n ? `${base}${String.fromCharCode(97 + n)}` : base);
  }
  return keys;
}

export function toBibtex(papers: PaperForCitation[]): { bibtex: string; keys: Map<string, string> } {
  const keys = bibtexKeys(papers);
  if (!papers.length) return { bibtex: "", keys };
  const cite = new Cite(papers.map((p) => paperToCsl(p, keys.get(p.id))));
  return { bibtex: String(cite.format("bibtex")), keys };
}

/* ───────────── Importing references ───────────── */

export type ImportedReference = {
  title: string;
  authors: PaperAuthor[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  abstract?: string;
};

type CslLike = {
  title?: string;
  author?: { family?: string; given?: string; literal?: string }[];
  issued?: { "date-parts"?: (number | string)[][] };
  "container-title"?: string | string[];
  DOI?: string;
  URL?: string;
  abstract?: string;
};

export function fromCsl(items: CslLike[]): ImportedReference[] {
  return items.flatMap((it) => {
    const title = (Array.isArray(it.title) ? it.title[0] : it.title)?.toString().trim();
    if (!title) return [];
    const year = Number(it.issued?.["date-parts"]?.[0]?.[0]);
    const venue = Array.isArray(it["container-title"]) ? it["container-title"][0] : it["container-title"];
    return [
      {
        title: title.slice(0, 1000),
        authors: (it.author ?? [])
          .map((a) => ({ name: (a.literal ?? [a.given, a.family].filter(Boolean).join(" ")).trim() }))
          .filter((a) => a.name)
          .slice(0, 50),
        year: Number.isFinite(year) && year > 0 ? year : undefined,
        venue: venue?.slice(0, 300),
        doi: it.DOI ? (normalizeDoi(it.DOI) ?? undefined) : undefined,
        url: it.URL,
        abstract: it.abstract?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000) || undefined,
      },
    ];
  });
}

/** Parse BibTeX, RIS or CSL-JSON (Zotero's "CSL JSON" export). */
export function parseReferences(text: string): ImportedReference[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  let items: CslLike[];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as CslLike | CslLike[];
    items = Array.isArray(parsed) ? parsed : [parsed];
  } else {
    const format = /^TY {2}- /m.test(trimmed) ? "@ris/file" : "@biblatex/text";
    items = new Cite(trimmed, { forceType: format } as unknown as ConstructorParameters<typeof Cite>[1]).data as CslLike[];
  }
  return fromCsl(items);
}
