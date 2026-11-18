/**
 * Helpers for Jobiza documents (TipTap / ProseMirror JSON). Pure functions,
 * shared by the editor, rendering, exports and the claim checker.
 */
import { splitSentences } from "../ingest/text";

export type Mark = { type: string; attrs?: Record<string, unknown> };
export type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: Mark[];
};

export type CitationItem = { paperId: string; locator?: string };
export type CitationAttrs = { id: string; items: CitationItem[] };

export function isCitation(n: DocNode): n is DocNode & { attrs: CitationAttrs } {
  return n.type === "citation" && Array.isArray((n.attrs as CitationAttrs | undefined)?.items);
}

/** Every citation node in reading order. */
export function collectCitations(doc: DocNode): CitationAttrs[] {
  const out: CitationAttrs[] = [];
  const walk = (n: DocNode) => {
    if (isCitation(n)) out.push({ id: String(n.attrs.id), items: n.attrs.items.filter((i) => i.paperId) });
    n.content?.forEach(walk);
  };
  walk(doc);
  return out.filter((c) => c.items.length);
}

/** Paper ids in order of first citation (numeric styles number them this way). */
export function citedPaperIds(doc: DocNode): string[] {
  const seen = new Set<string>();
  for (const c of collectCitations(doc)) for (const i of c.items) seen.add(i.paperId);
  return [...seen];
}

/* ───────────── Flattened blocks for export ───────────── */

export type Run = { text: string; bold?: boolean; italic?: boolean } | { citation: CitationAttrs };
export type Block =
  | { kind: "heading"; level: number; runs: Run[] }
  | { kind: "paragraph"; runs: Run[] }
  | { kind: "quote"; runs: Run[] }
  | { kind: "list"; ordered: boolean; items: Run[][] };

function inlineRuns(nodes: DocNode[] | undefined): Run[] {
  const runs: Run[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "text" && n.text) {
      const marks = new Set((n.marks ?? []).map((m) => m.type));
      runs.push({ text: n.text, bold: marks.has("bold") || undefined, italic: marks.has("italic") || undefined });
    } else if (n.type === "hardBreak") runs.push({ text: "\n" });
    else if (isCitation(n)) runs.push({ citation: { id: String(n.attrs.id), items: n.attrs.items } });
  }
  return runs;
}

/** Block-level structure: headings, paragraphs, quotes and (flattened) lists. */
export function toBlocks(doc: DocNode): Block[] {
  const blocks: Block[] = [];
  const listItems = (list: DocNode): Run[][] =>
    (list.content ?? []).map((li) => (li.content ?? []).flatMap((child) => (child.type === "paragraph" ? inlineRuns(child.content) : [])));
  for (const n of doc.content ?? []) {
    if (n.type === "heading") blocks.push({ kind: "heading", level: Number(n.attrs?.level ?? 2), runs: inlineRuns(n.content) });
    else if (n.type === "paragraph") blocks.push({ kind: "paragraph", runs: inlineRuns(n.content) });
    else if (n.type === "blockquote") for (const p of n.content ?? []) blocks.push({ kind: "quote", runs: inlineRuns(p.content) });
    else if (n.type === "bulletList" || n.type === "orderedList") blocks.push({ kind: "list", ordered: n.type === "orderedList", items: listItems(n) });
  }
  return blocks;
}

export function runsToText(runs: Run[], label: (c: CitationAttrs) => string = () => ""): string {
  return runs.map((r) => ("citation" in r ? label(r.citation) : r.text)).join("");
}

/* ───────────── Sentences for the claim checker ───────────── */

export type CheckSentence = { id: string; text: string; citations: CitationItem[] };

/**
 * Split the document's prose into sentences, attaching each citation to the
 * sentence it sits in (or ends). Headings are skipped; list items count as prose.
 */
export function sentencesWithCitations(doc: DocNode): CheckSentence[] {
  const out: CheckSentence[] = [];
  const paragraphs: Run[][] = [];
  for (const b of toBlocks(doc)) {
    if (b.kind === "paragraph" || b.kind === "quote") paragraphs.push(b.runs);
    else if (b.kind === "list") paragraphs.push(...b.items);
  }
  paragraphs.forEach((runs, p) => {
    // Text with a placeholder per citation so sentence splitting keeps positions.
    const cites: CitationAttrs[] = [];
    const text = runs
      .map((r) => {
        if ("citation" in r) {
          cites.push(r.citation);
          return ` \u0000${cites.length - 1}\u0000`;
        }
        return r.text;
      })
      .join("");
    let pending: CitationItem[] = [];
    splitSentences(text.replace(/\s+/g, " ")).forEach((sentence, s) => {
      const items: CitationItem[] = [...pending];
      pending = [];
      const clean = sentence
        .replace(/\s?\u0000(\d+)\u0000/g, (_, i) => {
          items.push(...cites[Number(i)].items);
          return "";
        })
        .trim();
      // A citation placed right after the full stop belongs to the previous sentence.
      if (!/[a-z0-9]/i.test(clean)) {
        if (out.length && items.length) out[out.length - 1].citations.push(...items);
        return;
      }
      out.push({ id: `p${p}s${s}`, text: clean, citations: items });
    });
  });
  return out;
}
