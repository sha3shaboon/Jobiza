"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client-api";

type Doc = { id: string; title: string; citationStyle: string; updatedAt: string };
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function DocumentList({ documents }: { documents: Doc[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState(documents);

  async function create() {
    setBusy(true);
    const { document } = await api<{ document: { id: string } }>("/api/v1/documents", { method: "POST", body: "{}" });
    router.push(`/app/writing/${document.id}`);
  }

  async function remove(d: Doc) {
    if (!confirm(`Delete “${d.title}”? This can't be undone.`)) return;
    await api(`/api/v1/documents/${d.id}`, { method: "DELETE" });
    setDocs((list) => list.filter((x) => x.id !== d.id));
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.02em]">Writing</h1>
          <p className="mt-2 text-lg text-muted">Draft with citations from your library, check every claim, and export to Word, PDF or LaTeX.</p>
        </div>
        <button className="btn-primary" onClick={create} disabled={busy}>
          {busy ? "Creating…" : "New document"}
        </button>
      </div>
      {docs.length === 0 ? (
        <div className="mt-10 flex flex-col items-start gap-4 border-t border-border py-10 sm:flex-row sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration */}
          <img src="/illustrations/sprout-pot.svg" alt="" width={220} height={280} className="h-auto w-28" />
          <div>
            <p className="text-lg font-medium">No documents yet</p>
            <p className="mt-1 max-w-md text-muted">Start a document and cite papers as you write, or ask Claude to draft a paragraph from your library.</p>
          </div>
        </div>
      ) : (
        <ul className="mt-8 border-b border-border">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-5">
              <div className="min-w-0">
                <Link href={`/app/writing/${d.id}`} className="text-lg font-medium break-words hover:underline">
                  {d.title}
                </Link>
                <p className="mt-1 text-sm text-muted">Edited {date.format(new Date(d.updatedAt))}</p>
              </div>
              <button className="btn-ghost min-h-10 px-3 text-sm hover:text-danger" onClick={() => remove(d)} aria-label={`Delete ${d.title}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
