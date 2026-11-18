"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { paperByline } from "@/lib/paper-format";
import type { PaperSummary } from "@/server/library";
import { HighlightedText } from "./highlighted-text";

const PdfViewer = dynamic(() => import("./pdf-viewer").then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => <div className="h-[70vh] animate-pulse rounded-[14px] bg-surface-2" aria-label="Loading PDF…" />,
});

type Paper = PaperSummary & { abstract: string | null };

export function PaperView({ paper, initialPage, highlight }: { paper: Paper; initialPage: number; highlight: string }) {
  const byline = paperByline(paper);
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/app/library" className="text-sm text-muted hover:text-text">
        ← Library
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-0.015em] break-words sm:text-3xl">{paper.title}</h1>
          {byline && <p className="mt-2 text-muted">{byline}</p>}
          <p className="mt-1 text-sm text-muted">
            {paper.doi && (
              <a className="link" href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer">
                doi.org/{paper.doi}
              </a>
            )}
            {!paper.doi && paper.url && (
              <a className="link" href={paper.url} target="_blank" rel="noreferrer">
                Original source
              </a>
            )}
          </p>
        </div>
        {paper.status === "ready" && (
          <Link href={`/app/ask?paper=${paper.id}`} className="btn-primary">
            Ask this paper
          </Link>
        )}
      </div>

      {highlight && (
        <p className="mt-6 rounded-[10px] bg-surface-2 px-4 py-3 text-sm">
          <span className="text-muted">Cited passage: </span>
          <span className="cited">{highlight}</span>
        </p>
      )}

      <div className="mt-6">
        {paper.hasFile ? (
          <PdfViewer paperId={paper.id} initialPage={initialPage} highlight={highlight} />
        ) : (
          <SectionViewer paper={paper} initialSection={initialPage} highlight={highlight} />
        )}
      </div>
    </div>
  );
}

/** Web articles and abstract-only papers: show the extracted text, one section at a time. */
function SectionViewer({ paper, initialSection, highlight }: { paper: Paper; initialSection: number; highlight: string }) {
  const total = paper.pageCount ?? 1;
  const [section, setSection] = useState(Math.min(initialSection, total));
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ text: string }>(`/api/v1/papers/${paper.id}/pages/${section}`).then(
      (r) => !cancelled && (setText(r.text), setError(null)),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [paper.id, section]);

  return (
    <article className="rounded-[14px] border border-border">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 text-sm">
        <span className="text-muted">
          {paper.metadataOnly ? "Abstract" : `Section ${section} of ${total}`}
        </span>
        {total > 1 && (
          <div className="flex gap-2">
            <button className="btn-secondary min-h-9 px-3 text-sm" disabled={section <= 1} onClick={() => setSection((s) => s - 1)}>
              Previous
            </button>
            <button className="btn-secondary min-h-9 px-3 text-sm" disabled={section >= total} onClick={() => setSection((s) => s + 1)}>
              Next
            </button>
          </div>
        )}
      </header>
      <div className="max-w-[44rem] px-5 py-6 text-[17px] leading-[1.75]">
        {error ? (
          <p className="text-danger">{error}</p>
        ) : text === null ? (
          <p className="text-muted">Loading…</p>
        ) : (
          <HighlightedText text={text} highlight={section === initialSection ? highlight : ""} />
        )}
      </div>
      {paper.metadataOnly && (
        <p className="border-t border-border px-5 py-3 text-sm text-muted">
          Only the abstract is available for this paper. Upload the PDF to ask about the full text.
        </p>
      )}
    </article>
  );
}
