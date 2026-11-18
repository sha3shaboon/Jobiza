"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatAuthors } from "@/lib/paper-format";
import type { CitationItem } from "@/lib/writing/doc";
import type { CitablePaper } from "./citation-node";

export type CitationDialogState = { mode: "insert" } | { mode: "edit"; pos: number; attrs: { id: string; items: CitationItem[] } };

/** Pick papers (and pages) for a new citation, or edit an existing one. */
export function CitationDialog({
  state,
  papers,
  onApply,
  onClose,
}: {
  state: CitationDialogState;
  papers: CitablePaper[];
  onApply: (items: CitationItem[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<CitationItem[]>(state.mode === "edit" ? state.attrs.items : []);
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const q = query.trim().toLowerCase();
  const results = papers
    .filter((p) => !items.some((i) => i.paperId === p.id))
    .filter((p) => !q || p.title.toLowerCase().includes(q) || p.authors.some((a) => a.toLowerCase().includes(q)) || String(p.year ?? "").includes(q))
    .slice(0, 50);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-[16px] border border-border bg-surface p-0 text-text backdrop:bg-black/40"
      aria-labelledby="cite-title"
    >
      <div className="p-6">
        <h2 id="cite-title" className="text-xl font-semibold">
          {state.mode === "edit" ? "Edit citation" : "Cite papers"}
        </h2>

        {items.length > 0 && (
          <ul className="mt-4 grid gap-2">
            {items.map((item, i) => (
              <li key={item.paperId} className="flex flex-wrap items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-2">
                <span className="min-w-0 flex-1 text-[15px] break-words">{byId.get(item.paperId)?.title ?? "A paper that's no longer in your library"}</span>
                <label className="flex items-center gap-2 text-sm text-muted">
                  Page
                  <input
                    name={`page-${i}`}
                    value={item.locator ?? ""}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, locator: e.target.value.slice(0, 20) || undefined } : x)))}
                    className="input min-h-9 w-20 py-0 text-sm"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </label>
                <button className="text-sm text-muted hover:text-danger" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove this paper from the citation">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <label htmlFor="cite-search" className="label mt-5">
          Find a paper in your library
        </label>
        <input
          id="cite-search"
          name="cite-search"
          autoFocus
          className="input"
          placeholder="Title, author or year…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <ul className="mt-2 max-h-72 overflow-y-auto">
          {results.map((p) => (
            <li key={p.id}>
              <button
                className="w-full rounded-[8px] px-3 py-2.5 text-left hover:bg-surface-2"
                onClick={() => {
                  setItems([...items, { paperId: p.id }]);
                  setQuery("");
                }}
              >
                <span className="block text-[15px] font-medium">{p.title}</span>
                <span className="block text-sm text-muted">{[formatAuthors(p.authors, 2), p.year].filter(Boolean).join(", ")}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-3 text-sm text-muted">{papers.length ? "No matching papers." : "Your library is empty. Add papers first."}</li>}
        </ul>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">
        {state.mode === "edit" && (
          <button className="btn-ghost mr-auto text-danger" onClick={() => onApply([])}>
            Delete citation
          </button>
        )}
        <button className="btn-ghost" onClick={() => ref.current?.close()}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!items.length} onClick={() => onApply(items)}>
          {state.mode === "edit" ? "Save" : "Insert citation"}
        </button>
      </div>
    </dialog>
  );
}
