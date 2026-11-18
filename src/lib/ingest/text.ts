/**
 * Text utilities for ingestion and retrieval. Pure functions: no I/O.
 */

/** Collapse PDF extraction artefacts: hyphenated line breaks, runs of whitespace. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/(\w)-\n(\w)/g, "$1$2") // re-join words hyphenated across lines
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const ABBREVIATIONS = /\b(?:e\.g|i\.e|et al|etc|vs|cf|fig|figs|eq|eqs|no|vol|pp|dr|mr|mrs|ms|prof|approx|ca)\.$/i;

/**
 * Split text into sentences. Conservative: never splits after common academic
 * abbreviations ("et al.", "e.g.", "Fig.") or inside decimals.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?]+(?:[.!?]+["')\]]*|$)/g;
  let buffer = "";
  for (const match of text.matchAll(re)) {
    const piece = match[0];
    buffer += piece;
    const trimmed = buffer.trim();
    const next = text.slice((match.index ?? 0) + piece.length);
    const endsWithAbbrev = ABBREVIATIONS.test(trimmed);
    const decimal = /\d\.$/.test(trimmed) && /^\d/.test(next);
    const nextStartsLower = /^\s*[a-z]/.test(next);
    if (!endsWithAbbrev && !decimal && !nextStartsLower && trimmed) {
      out.push(trimmed);
      buffer = "";
    }
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out;
}

export type TextChunk = { pageNumber: number; chunkIndex: number; text: string };

/**
 * Split each page into overlapping passages of roughly `targetChars`, cutting
 * at sentence boundaries. Chunks never cross pages, so every chunk maps to
 * exactly one page for citations.
 */
export function chunkPages(
  pages: { pageNumber: number; text: string }[],
  { targetChars = 1100, overlapSentences = 1, minChars = 40 } = {},
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let index = 0;
  for (const page of pages) {
    const sentences = splitSentences(page.text.replace(/\n+/g, " "));
    let current: string[] = [];
    let length = 0;
    const flush = () => {
      const text = current.join(" ").trim();
      if (text.length >= minChars) chunks.push({ pageNumber: page.pageNumber, chunkIndex: index++, text });
    };
    for (const sentence of sentences) {
      // Very long "sentences" (tables, reference lists) are hard-wrapped.
      const parts = sentence.length > targetChars * 1.5 ? hardWrap(sentence, targetChars) : [sentence];
      for (const part of parts) {
        if (length + part.length > targetChars && current.length) {
          flush();
          current = current.slice(-overlapSentences);
          length = current.reduce((n, s) => n + s.length + 1, 0);
        }
        current.push(part);
        length += part.length + 1;
      }
    }
    if (current.length) flush();
  }
  return chunks;
}

function hardWrap(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(" ", size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

/** Find the first DOI in text (e.g. a PDF's first page). */
export function findDoi(text: string): string | null {
  const m = text.match(/\b(10\.\d{4,9}\/[^\s"<>]+)/i);
  if (!m) return null;
  return normalizeDoi(m[1]);
}

/** arXiv papers carry their id ("arXiv:1706.03762v7") instead of a DOI; every id has a DataCite DOI. */
export function findArxivDoi(text: string): string | null {
  const m = text.match(/arXiv:\s*(\d{4}\.\d{4,5})(?:v\d+)?/i) ?? text.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i);
  return m ? `10.48550/arxiv.${m[1]}` : null;
}

/** Accepts "10.x/y", "doi:10.x/y" or "https://doi.org/10.x/y"; returns lower-cased bare DOI or null. */
export function normalizeDoi(input: string): string | null {
  const m = input
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .match(/^(10\.\d{4,9}\/\S+)$/i);
  if (!m) return null;
  return m[1].replace(/[.,;)\]]+$/, "").toLowerCase();
}

/**
 * Reciprocal rank fusion: merges several ranked lists of ids into one.
 * score(id) = Σ 1 / (k + rank), rank starting at 1.
 */
export function reciprocalRankFusion(lists: string[][], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

/** OpenAlex returns abstracts as an inverted index; rebuild the plain text. */
export function abstractFromInvertedIndex(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  const text = words.filter(Boolean).join(" ").trim();
  return text || null;
}
