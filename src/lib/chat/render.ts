import type { MessageCitation } from "@/db/schema";

export type Note = { n: number; citation: MessageCitation };
export type Segment = { text: string; refs: number[] };

/**
 * Split an answer into plain and cited segments, numbering each distinct
 * source passage in order of first appearance (1, 2, 3…). A cited segment
 * carries the note numbers to show after it.
 */
export function segmentAnswer(text: string, citations: MessageCitation[]): { segments: Segment[]; notes: Note[] } {
  const notes: Note[] = [];
  const numberOf = new Map<string, number>();
  const spans = new Map<string, { start: number; end: number; refs: number[] }>();

  const ordered = [...citations].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const c of ordered) {
    const key = `${c.paperId}|${c.pageNumber}|${c.citedText}`;
    let n = numberOf.get(key);
    if (n === undefined) {
      n = notes.length + 1;
      numberOf.set(key, n);
      notes.push({ n, citation: c });
    }
    const spanKey = `${c.start}:${c.end}`;
    const span = spans.get(spanKey) ?? { start: c.start, end: c.end, refs: [] };
    if (!span.refs.includes(n)) span.refs.push(n);
    spans.set(spanKey, span);
  }

  const segments: Segment[] = [];
  let cursor = 0;
  for (const span of [...spans.values()].sort((a, b) => a.start - b.start)) {
    const start = Math.max(span.start, cursor);
    if (span.end <= start) continue; // overlapping spans: keep the first
    if (start > cursor) segments.push({ text: text.slice(cursor, start), refs: [] });
    segments.push({ text: text.slice(start, span.end), refs: span.refs.sort((a, b) => a - b) });
    cursor = span.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), refs: [] });
  return { segments, notes };
}

export function citationHref(c: Pick<MessageCitation, "paperId" | "pageNumber" | "citedText">): string {
  const params = new URLSearchParams({ page: String(c.pageNumber), hl: c.citedText.slice(0, 600) });
  return `/app/library/${c.paperId}?${params}`;
}
