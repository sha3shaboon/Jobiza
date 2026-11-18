import type Anthropic from "@anthropic-ai/sdk";
import type { MessageCitation } from "@/db/schema";
import { splitSentences } from "../ingest/text";

/** What we send to Claude for each retrieved passage, and how we map citations back. */
export type Source = {
  chunkId: string;
  paperId: string;
  paperTitle: string;
  authors: string[];
  year: number | null;
  pageNumber: number;
  locator: "page" | "section";
  /** Sentences of the passage; each becomes one citable text block. */
  sentences: string[];
};

export function shortAuthors(authors: string[]): string {
  if (!authors.length) return "";
  const last = (n: string) => n.trim().split(/\s+/).at(-1) ?? n;
  if (authors.length === 1) return last(authors[0]);
  if (authors.length === 2) return `${last(authors[0])} and ${last(authors[1])}`;
  return `${last(authors[0])} et al.`;
}

export function sourceLabel(s: Pick<Source, "paperTitle" | "authors" | "year" | "pageNumber" | "locator">): string {
  const who = [shortAuthors(s.authors), s.year].filter(Boolean).join(", ");
  return `${s.paperTitle}${who ? ` (${who})` : ""}, ${s.locator} ${s.pageNumber}`;
}

export function toSource(chunk: Omit<Source, "sentences"> & { text: string }): Source {
  const { text, ...rest } = chunk;
  const sentences = splitSentences(text);
  return { ...rest, sentences: sentences.length ? sentences : [text] };
}

/** Search-result content blocks for one request (citations on). */
export function searchResultBlocks(sources: Source[]): Anthropic.SearchResultBlockParam[] {
  return sources.map((s) => ({
    type: "search_result",
    source: `jobiza://paper/${s.paperId}#${s.locator}=${s.pageNumber}`,
    title: sourceLabel(s),
    content: s.sentences.map((text) => ({ type: "text", text })),
    citations: { enabled: true },
  }));
}

export type BuiltAnswer = { text: string; citations: MessageCitation[] };

/**
 * Flatten Claude's response into plain text plus citations with character
 * ranges. Claude splits its answer into text blocks at citation boundaries,
 * so joining the blocks reproduces the answer and each cited block is a span.
 */
export function buildAnswer(content: Anthropic.ContentBlock[], sources: Source[]): BuiltAnswer {
  let text = "";
  const citations: MessageCitation[] = [];
  for (const block of content) {
    if (block.type !== "text") continue;
    const start = text.length;
    text += block.text;
    for (const c of block.citations ?? []) {
      if (c.type !== "search_result_location") continue;
      const source = sources[c.search_result_index];
      if (!source) continue;
      citations.push({
        start,
        end: text.length,
        paperId: source.paperId,
        paperTitle: source.paperTitle,
        pageNumber: source.pageNumber,
        locator: source.locator,
        chunkId: source.chunkId,
        citedText: c.cited_text || source.sentences.slice(c.start_block_index, c.end_block_index).join(" "),
      });
    }
  }
  return { text: text.trim() ? text : text, citations };
}
