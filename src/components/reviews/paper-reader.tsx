"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SectionViewer, type Paper } from "@/components/library/paper-view";
import { api } from "@/lib/client-api";
import { formatAuthors } from "@/lib/paper-format";
import type { ReviewRecordDto } from "@/server/reviews";

const PdfViewer = dynamic(() => import("@/components/library/pdf-viewer").then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => <div className="h-[60vh] animate-pulse rounded-[14px] bg-surface-2" aria-label="Loading PDF…" />,
});

const SOURCE_NAMES: Record<string, string> = { openalex: "OpenAlex", semantic_scholar: "Semantic Scholar", arxiv: "arXiv", pubmed: "PubMed" };
const POLL_MS = 2500;

/** Where else the paper can be opened. */
function externalLinks(r: ReviewRecordDto) {
  const links: { label: string; href: string }[] = [];
  if (r.doi) links.push({ label: "Publisher (DOI)", href: `https://doi.org/${r.doi}` });
  if (r.pmid) links.push({ label: "PubMed", href: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` });
  if (r.arxivId) links.push({ label: "arXiv", href: `https://arxiv.org/abs/${r.arxivId}` });
  if (!links.length && r.url) links.push({ label: "Original source", href: r.url });
  return links;
}

/**
 * Side panel for reading a paper a review found: details, Claude's notes, and the
 * full text right here (fetched into the library on request).
 */
export function PaperReader({
  record: r,
  reviewId,
  onRecord,
  onClose,
}: {
  record: ReviewRecordDto;
  reviewId: string;
  onRecord: (r: ReviewRecordDto) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [paper, setPaper] = useState<Paper | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const processing = paper ? paper.status === "queued" || paper.status === "processing" : Boolean(r.paperId && r.fullText === "pending");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Load the library copy, and keep checking while its text is being fetched.
  useEffect(() => {
    if (!r.paperId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const { paper } = await api<{ paper: Paper }>(`/api/v1/papers/${r.paperId}`);
        if (cancelled) return;
        setPaper(paper);
        if (paper.status === "queued" || paper.status === "processing") timer = setTimeout(load, POLL_MS);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [r.paperId]);

  async function read() {
    setStarting(true);
    setError(null);
    try {
      const { record } = await api<{ record: ReviewRecordDto }>(`/api/v1/reviews/${reviewId}/records/${r.id}/read`, { method: "POST" });
      onRecord(record);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  const byline = [formatAuthors(r.authors, 6), r.year, r.venue].filter(Boolean).join(", ");
  const links = externalLinks(r);
  const ready = paper?.status === "ready";
  const matrix = Object.entries(r.matrix ?? {});

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="reader-title"
      className="ml-auto mr-0 h-dvh max-h-none w-[min(68rem,100vw)] max-w-none overflow-hidden border-l border-border bg-surface p-0 text-text backdrop:bg-black/40"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start gap-4 border-b border-border px-5 py-4 sm:px-8">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              Found in {r.sources.map((s) => SOURCE_NAMES[s] ?? s).join(", ")}
              {r.citationCount ? ` · cited ${r.citationCount.toLocaleString()} times` : ""}
            </p>
            <h2 id="reader-title" className="mt-1 text-xl leading-snug font-semibold break-words sm:text-2xl">
              {r.title}
            </h2>
            {byline && <p className="mt-1 text-sm text-muted">{byline}</p>}
          </div>
          <button className="btn-ghost min-h-10 shrink-0 px-3" onClick={() => ref.current?.close()} aria-label="Close the reader">
            Close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_19rem]">
          <main className="min-w-0 px-5 py-6 sm:px-8">
            {error && (
              <p role="alert" className="mb-4 rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                {error}
              </p>
            )}

            {ready && paper ? (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Link href={`/app/ask?paper=${paper.id}`} className="btn-primary min-h-10 px-4 text-sm">
                    Ask this paper
                  </Link>
                  <Link href={`/app/library/${paper.id}`} className="btn-secondary min-h-10 px-4 text-sm">
                    Open in library
                  </Link>
                  {paper.metadataOnly && <span className="text-sm text-muted">Only the abstract could be fetched.</span>}
                </div>
                {paper.hasFile ? (
                  <PdfViewer paperId={paper.id} initialPage={1} highlight="" />
                ) : (
                  <SectionViewer paper={paper} initialSection={1} highlight="" />
                )}
              </>
            ) : processing ? (
              <div className="rounded-[14px] border border-border px-5 py-8" aria-live="polite">
                <p className="flex items-center gap-2 font-medium">
                  <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-cite motion-reduce:animate-none" />
                  Getting the full text…
                </p>
                <p className="mt-1 text-sm text-muted">{paper?.statusDetail ?? "Downloading and reading the paper. This usually takes under a minute."}</p>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-medium text-muted">Abstract</h3>
                <p className="mt-2 max-w-[44rem] text-[17px] leading-[1.75] whitespace-pre-line">{r.abstract || "No abstract was found for this paper."}</p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button className="btn-primary" onClick={read} disabled={starting}>
                    {starting ? "Starting…" : paper?.status === "failed" || r.fullText === "failed" ? "Try again" : "Read the full text here"}
                  </button>
                  <p className="text-sm text-muted">
                    {r.openAccess
                      ? "An open-access copy is available. It's added to your library so you can ask about it."
                      : "Jobiza looks for an open-access copy. If there isn't one, the abstract is added to your library."}
                  </p>
                </div>
                {paper?.status === "failed" && paper.statusDetail && <p className="mt-3 text-sm text-danger">{paper.statusDetail}</p>}
              </>
            )}
          </main>

          <aside className="border-t border-border px-5 py-6 text-sm sm:px-8 lg:border-t-0 lg:border-l lg:px-6" aria-label="About this paper">
            <h3 className="font-medium">Screening</h3>
            <p className="mt-1">
              {r.screening === "included" ? "Included" : r.screening === "excluded" ? "Excluded" : "Not screened yet"}
              {r.decidedBy && r.screening !== "pending" ? <span className="text-muted"> by {r.decidedBy === "ai" ? "Claude" : "you"}</span> : null}
            </p>
            {r.screening === "excluded" && r.exclusionReason && <p className="mt-1 text-muted">{r.exclusionReason}</p>}
            {r.ai && (
              <div className="mt-3 rounded-[10px] bg-surface-2 px-3 py-2.5">
                <p className="font-medium">
                  Claude: {r.ai.decision}
                  <span className="ml-1 font-normal text-muted tabular-nums">({r.ai.relevance}/100 relevant)</span>
                </p>
                <p className="mt-1 text-muted">{r.ai.reason}</p>
              </div>
            )}

            {matrix.length > 0 && (
              <>
                <h3 className="mt-6 font-medium">From the comparison table</h3>
                <dl className="mt-2 grid gap-2.5">
                  {matrix.map(([col, cell]) => (
                    <div key={col}>
                      <dt className="text-muted">{col}</dt>
                      <dd>
                        {cell.value}
                        {cell.page && r.paperId ? (
                          <Link href={`/app/library/${r.paperId}?page=${cell.page}`} className="ml-1 text-xs text-muted underline underline-offset-2">
                            p. {cell.page}
                          </Link>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            {links.length > 0 && (
              <>
                <h3 className="mt-6 font-medium">Open elsewhere</h3>
                <ul className="mt-2 grid gap-1.5">
                  {links.map((l) => (
                    <li key={l.href}>
                      <a href={l.href} target="_blank" rel="noreferrer" className="link">
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        </div>
      </div>
    </dialog>
  );
}
