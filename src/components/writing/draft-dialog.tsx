"use client";

import { useEffect, useRef, useState } from "react";
import { ScopePicker } from "@/components/ask/scope-picker";
import { api } from "@/lib/client-api";
import type { DocNode } from "@/lib/writing/doc";
import type { PaperSummary } from "@/server/library";
import type { CitablePaper } from "./citation-node";

const EXAMPLES = [
  "A paragraph introducing the main findings on this topic",
  "A short comparison of the methods these studies used",
  "The limitations of the current evidence",
];

/** Ask Claude to draft from the library; the result is inserted with real citations. */
export function DraftDialog({
  docId,
  papers,
  onInsert,
  onClose,
}: {
  docId: string;
  papers: CitablePaper[];
  onInsert: (nodes: DocNode[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = papers.filter((p) => p.status === "ready");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function draft(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ nodes: DocNode[] }>(`/api/v1/documents/${docId}/draft`, {
        method: "POST",
        body: JSON.stringify({ instruction, scopePaperIds: scope }),
      });
      onInsert(res.nodes);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-[16px] border border-border bg-surface p-0 text-text backdrop:bg-black/40"
      aria-labelledby="draft-title"
    >
      <form onSubmit={draft}>
        <div className="p-6">
          <h2 id="draft-title" className="text-xl font-semibold">
            Draft with Claude
          </h2>
          <p className="mt-1 text-sm text-muted">Claude writes only from your library, citing the papers and pages it uses. It&apos;s inserted at your cursor for you to edit.</p>
          <label htmlFor="instruction" className="label mt-5">
            What should Claude write?
          </label>
          <textarea
            id="instruction"
            name="instruction"
            rows={3}
            required
            minLength={5}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            className="input resize-y py-3"
            placeholder="A paragraph on how sleep loss affects memory in teenagers"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((x) => (
              <button key={x} type="button" className="rounded-full border border-border px-3 py-1 text-sm text-muted hover:text-text" onClick={() => setInstruction(x)}>
                {x}
              </button>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-3">
            <span className="text-sm font-medium">Sources</span>
            <ScopePicker papers={ready as unknown as PaperSummary[]} value={scope} onChange={setScope} />
          </div>
          {error && (
            <p role="alert" className="mt-4 rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button type="button" className="btn-ghost" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || instruction.trim().length < 5 || !ready.length}>
            {busy ? "Writing…" : "Draft it"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
