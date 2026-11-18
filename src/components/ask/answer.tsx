"use client";

import Link from "next/link";
import type { MessageCitation } from "@/db/schema";
import { citationHref, segmentAnswer } from "@/lib/chat/render";

/**
 * An answer in the reading column with its evidence in the margin:
 * cited claims are highlighted and numbered; each note shows the paper,
 * the page and the exact passage, and opens the page with it highlighted.
 */
export function Answer({
  content,
  citations,
  pending,
  error,
}: {
  content: string;
  citations: MessageCitation[];
  pending: boolean;
  error: string | null;
}) {
  const { segments, notes } = segmentAnswer(content, citations);

  return (
    <div className="grid gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,40rem)_16rem]">
      <div aria-live={pending ? "polite" : undefined} aria-busy={pending}>
        {content ? (
          <p className="text-[17px] leading-[1.75] whitespace-pre-wrap">
            {segments.map((s, i) =>
              s.refs.length ? (
                <span key={i}>
                  <span className="cited">{s.text}</span>
                  {s.refs.map((n) => (
                    <a
                      key={n}
                      href={`#note-${notes[n - 1].citation.chunkId}-${n}`}
                      className="ml-0.5 align-super text-xs font-semibold text-cite no-underline hover:underline"
                      aria-label={`Source ${n}`}
                    >
                      {n}
                    </a>
                  ))}
                </span>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
            {pending && <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-text align-middle motion-reduce:animate-none" />}
          </p>
        ) : pending ? (
          <p className="text-muted">Searching your papers…</p>
        ) : null}
        {error && (
          <p role="alert" className={`mt-3 rounded-[10px] px-3.5 py-2.5 text-sm ${error === "Stopped." ? "bg-surface-2 text-muted" : "bg-danger-soft text-danger"}`}>
            {error}
          </p>
        )}
      </div>

      {notes.length > 0 && (
        <aside aria-label="Sources" className="xl:border-l xl:border-border xl:pl-6">
          <ol className="grid gap-5">
            {notes.map(({ n, citation: c }) => (
              <li key={n} id={`note-${c.chunkId}-${n}`} className="flex gap-3 text-sm leading-relaxed">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cite text-[11px] font-semibold text-white dark:text-[var(--bg)]">
                  {n}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium break-words">{c.paperTitle}</span>
                  <span className="mt-1 line-clamp-4 block text-[15px] italic">&ldquo;{c.citedText}&rdquo;</span>
                  <Link href={citationHref(c)} className="link mt-1 inline-block text-muted">
                    {c.locator === "section" ? "Section" : "Page"} {c.pageNumber}
                  </Link>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}
