"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { paperByline } from "@/lib/paper-format";
import type { PaperSummary } from "@/server/library";
import { ImportReferences } from "./import-references";

const POLL_MS = 3000;

export function LibraryView({ initialPapers }: { initialPapers: PaperSummary[] }) {
  const [papers, setPapers] = useState(initialPapers);
  const busy = papers.some((p) => p.status === "queued" || p.status === "processing");

  const refresh = useCallback(async () => {
    const { papers } = await api<{ papers: PaperSummary[] }>("/api/v1/papers");
    setPapers(papers);
  }, []);

  // Poll while anything is being processed.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void refresh().catch(() => undefined), POLL_MS);
    return () => clearInterval(t);
  }, [busy, refresh]);

  const added = (p: PaperSummary) => setPapers((list) => [p, ...list.filter((x) => x.id !== p.id)]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.02em]">Library</h1>
          <p className="mt-2 text-lg text-muted">The papers Jobiza answers from. Add PDFs, DOIs or links.</p>
        </div>
        {papers.some((p) => p.status === "ready") && (
          <Link href="/app/ask" className="btn-primary">
            Ask your library
          </Link>
        )}
      </div>

      <AddSources onAdded={added} />
      <ImportReferences onImported={() => void refresh()} />

      <section aria-labelledby="papers-title" className="mt-12">
        <h2 id="papers-title" className="sr-only">
          Papers
        </h2>
        {papers.length === 0 ? (
          <div className="flex flex-col items-start gap-4 border-t border-border py-10 sm:flex-row sm:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration */}
            <img src="/illustrations/sprout-pot.svg" alt="" width={220} height={280} className="h-auto w-28" />
            <div>
              <p className="text-lg font-medium">Nothing planted yet</p>
              <p className="mt-1 max-w-md text-muted">
                Add your first paper above. Once it&apos;s processed you can ask questions about it and get answers that cite the page.
              </p>
            </div>
          </div>
        ) : (
          <ul className="border-b border-border">
            {papers.map((p) => (
              <PaperRow key={p.id} paper={p} onChange={refresh} onDeleted={() => setPapers((l) => l.filter((x) => x.id !== p.id))} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddSources({ onAdded }: { onAdded: (p: PaperSummary) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [link, setLink] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | File[]) {
    setError(null);
    const pdfs = [...files].filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) {
      setError("Only PDF files can be uploaded.");
      return;
    }
    setUploading((n) => n + pdfs.length);
    await Promise.all(
      pdfs.map(async (file) => {
        try {
          const form = new FormData();
          form.append("file", file);
          const { paper } = await api<{ paper: PaperSummary }>("/api/v1/papers", { method: "POST", body: form });
          onAdded(paper);
        } catch (e) {
          setError(`${file.name}: ${(e as Error).message}`);
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
  }

  async function importLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setImporting(true);
    try {
      const { paper } = await api<{ paper: PaperSummary }>("/api/v1/papers/import", {
        method: "POST",
        body: JSON.stringify({ input: link }),
      });
      onAdded(paper);
      setLink("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <section aria-label="Add papers" className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
        className={`flex min-h-36 flex-col items-center justify-center gap-3 rounded-[14px] border-2 border-dashed px-6 py-8 text-center transition-colors duration-150 ${
          dragging ? "border-accent bg-accent-soft" : "border-border bg-surface-2"
        }`}
      >
        <p className="font-medium">{uploading ? `Uploading ${uploading} ${uploading === 1 ? "file" : "files"}…` : "Drop PDFs here"}</p>
        <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
          Choose files
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-sm text-muted">Up to 50 MB each. Scanned pages are read with Claude.</p>
      </div>

      <form onSubmit={importLink} className="flex flex-col justify-center gap-3 rounded-[14px] border border-border p-6">
        <label htmlFor="import" className="font-medium">
          Import by DOI or link
        </label>
        <input
          id="import"
          name="import"
          className="input"
          placeholder="10.1038/nature14539 or https://…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={importing || !link.trim()}>
            {importing ? "Importing…" : "Import"}
          </button>
          <p className="text-sm text-muted">Open-access PDFs are fetched automatically.</p>
        </div>
      </form>

      {error && (
        <p role="alert" className="rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger lg:col-span-2">
          {error}
        </p>
      )}
    </section>
  );
}

const STATUS_LABEL = { queued: "Waiting", processing: "Processing", ready: "Ready", failed: "Couldn't process" } as const;

function StatusPill({ paper }: { paper: PaperSummary }) {
  const styles = {
    queued: "bg-surface-2 text-muted",
    processing: "bg-surface-2 text-text",
    ready: "bg-accent-soft text-accent",
    failed: "bg-danger-soft text-danger",
  }[paper.status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}>
      {paper.status === "processing" && (
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
      )}
      {STATUS_LABEL[paper.status]}
    </span>
  );
}

function PaperRow({ paper, onChange, onDeleted }: { paper: PaperSummary; onChange: () => Promise<void>; onDeleted: () => void }) {
  const [working, setWorking] = useState(false);
  const byline = paperByline(paper);
  const ready = paper.status === "ready";

  async function retry() {
    setWorking(true);
    try {
      await api(`/api/v1/papers/${paper.id}/retry`, { method: "POST" });
      await onChange();
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete “${paper.title}” from your library? Answers that cited it keep their text.`)) return;
    setWorking(true);
    try {
      await api(`/api/v1/papers/${paper.id}`, { method: "DELETE" });
      onDeleted();
    } finally {
      setWorking(false);
    }
  }

  return (
    <li className="grid gap-3 border-t border-border py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {ready ? (
            <Link href={`/app/library/${paper.id}`} className="min-w-0 text-lg font-medium break-words hover:underline">
              {paper.title}
            </Link>
          ) : (
            <span className="min-w-0 text-lg font-medium break-words">{paper.title}</span>
          )}
          <StatusPill paper={paper} />
        </div>
        {byline && <p className="mt-1 text-sm text-muted">{byline}</p>}
        {paper.statusDetail && (
          <p className={`mt-1 text-sm ${paper.status === "failed" ? "text-danger" : "text-muted"}`} aria-live="polite">
            {paper.statusDetail}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ready && (
          <Link href={`/app/ask?paper=${paper.id}`} className="btn-secondary min-h-10 px-4 text-sm">
            Ask this paper
          </Link>
        )}
        {paper.status === "failed" && (
          <button className="btn-secondary min-h-10 px-4 text-sm" onClick={retry} disabled={working}>
            Try again
          </button>
        )}
        <button
          className="btn-ghost min-h-10 px-3 text-sm hover:text-danger"
          onClick={remove}
          disabled={working}
          aria-label={`Delete ${paper.title}`}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
