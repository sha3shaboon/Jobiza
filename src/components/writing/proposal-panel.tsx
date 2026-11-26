"use client";

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProposalPlan, ProposalSection } from "@/db/schema";
import { api } from "@/lib/client-api";
import type { DocNode } from "@/lib/writing/doc";

type Located = { headingPos: number; from: number; to: number; empty: boolean };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Find each plan section's heading in the document and the content under it (up to the next H2). */
export function locateSections(doc: PMNode, sections: ProposalSection[]): Map<string, Located> {
  const headings: { pos: number; end: number; text: string }[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === "heading" && node.attrs.level === 2) headings.push({ pos: offset, end: offset + node.nodeSize, text: norm(node.textContent) });
  });
  const used = new Set<number>();
  const out = new Map<string, Located>();
  for (const s of sections) {
    const i = headings.findIndex((h, j) => !used.has(j) && h.text === norm(s.heading));
    if (i < 0) continue;
    used.add(i);
    const h = headings[i];
    const to = i + 1 < headings.length ? headings[i + 1].pos : doc.content.size;
    let empty = !doc.textBetween(h.end, to, " ", " ").trim();
    doc.nodesBetween(h.end, to, (n) => {
      if (n.type.name === "citation") empty = false;
    });
    out.set(s.id, { headingPos: h.pos, from: h.end, to, empty });
  }
  return out;
}

type Status = { state: "idle" } | { state: "writing"; sectionId: string; done: number; total: number } | { state: "error"; message: string };

/** Margin panel for proposals: the plan, and writing or redrafting each section with Claude. */
export function ProposalPanel({
  editor,
  docId,
  plan,
  autoStart,
  beforeWrite,
  onWritten,
}: {
  editor: Editor | null;
  docId: string;
  plan: ProposalPlan;
  autoStart: boolean;
  beforeWrite: () => Promise<void>;
  onWritten: () => void;
}) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [, setTick] = useState(0);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const stop = useRef(false);
  const started = useRef(false);

  // Re-render when the document changes, so each section's status stays current.
  useEffect(() => {
    if (!editor) return;
    const update = () => setTick((t) => t + 1);
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);

  const writeOne = useCallback(
    async (section: ProposalSection, extra?: string) => {
      if (!editor) return;
      const before = locateSections(editor.state.doc, plan.sections).get(section.id);
      // Everything above this section, for consistency.
      const priorText = editor.state.doc.textBetween(0, before?.headingPos ?? editor.state.doc.content.size, "\n\n", " ").slice(-8000);
      const { nodes } = await api<{ nodes: DocNode[] }>(`/api/v1/documents/${docId}/proposal-section`, {
        method: "POST",
        body: JSON.stringify({ sectionId: section.id, priorText, note: extra || undefined }),
      });
      // The document may have changed while Claude wrote: locate the section again.
      const where = locateSections(editor.state.doc, plan.sections).get(section.id);
      if (where) {
        editor.chain().insertContentAt({ from: where.from, to: where.to }, nodes).run();
      } else {
        // Heading was deleted or renamed: put the section back before the next one that still exists.
        const idx = plan.sections.findIndex((s) => s.id === section.id);
        const located = locateSections(editor.state.doc, plan.sections);
        const next = plan.sections.slice(idx + 1).map((s) => located.get(s.id)).find(Boolean);
        const at = next ? next.headingPos : editor.state.doc.content.size;
        editor
          .chain()
          .insertContentAt(at, [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: section.heading }] }, ...nodes])
          .run();
      }
      onWritten();
    },
    [editor, docId, plan.sections, onWritten],
  );

  const writeAll = useCallback(
    async (onlyEmpty: boolean) => {
      if (!editor) return;
      stop.current = false;
      await beforeWrite();
      const located = locateSections(editor.state.doc, plan.sections);
      const todo = plan.sections.filter((s) => !onlyEmpty || located.get(s.id)?.empty !== false);
      try {
        for (let i = 0; i < todo.length; i++) {
          if (stop.current) break;
          setStatus({ state: "writing", sectionId: todo[i].id, done: i, total: todo.length });
          await writeOne(todo[i]);
        }
        setStatus({ state: "idle" });
      } catch (err) {
        setStatus({ state: "error", message: (err as Error).message });
      }
    },
    [editor, plan.sections, beforeWrite, writeOne],
  );

  async function redraft(section: ProposalSection) {
    const extra = note;
    setNoteFor(null);
    setNote("");
    setStatus({ state: "writing", sectionId: section.id, done: 0, total: 1 });
    try {
      await beforeWrite();
      await writeOne(section, extra);
      setStatus({ state: "idle" });
    } catch (err) {
      setStatus({ state: "error", message: (err as Error).message });
    }
  }

  // A proposal that was just created starts writing on its own.
  useEffect(() => {
    if (!autoStart || started.current || !editor) return;
    // Deferred, so a development double-mount cancels the first attempt instead of running twice.
    const t = setTimeout(() => {
      started.current = true;
      const located = locateSections(editor.state.doc, plan.sections);
      if (plan.sections.every((s) => located.get(s.id)?.empty !== false)) void writeAll(true);
    }, 0);
    return () => clearTimeout(t);
  }, [autoStart, editor, plan.sections, writeAll]);

  if (!editor) return null;
  const located = locateSections(editor.state.doc, plan.sections);
  const writing = status.state === "writing";
  const remaining = plan.sections.filter((s) => located.get(s.id)?.empty !== false).length;

  return (
    <div className="text-sm">
      {writing && (
        <div className="mb-4 rounded-[10px] bg-surface-2 px-3 py-2.5" aria-live="polite">
          <p className="flex items-center gap-2 font-medium">
            <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-cite motion-reduce:animate-none" />
            Writing “{plan.sections.find((s) => s.id === status.sectionId)?.heading}”
            {status.total > 1 && (
              <span className="font-normal text-muted tabular-nums">
                ({status.done + 1} of {status.total})
              </span>
            )}
          </p>
          {status.total > 1 && (
            <button className="mt-2 text-muted underline underline-offset-2 hover:text-text" onClick={() => (stop.current = true)}>
              Stop after this section
            </button>
          )}
        </div>
      )}
      {status.state === "error" && (
        <p role="alert" className="mb-4 rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-danger">
          {status.message}
        </p>
      )}
      {!writing && remaining > 0 && (
        <button className="btn-primary mb-5 w-full" onClick={() => void writeAll(true)}>
          {remaining === plan.sections.length ? "Write the proposal with Claude" : `Write the ${remaining} remaining ${remaining === 1 ? "section" : "sections"}`}
        </button>
      )}

      <details className="mb-5 rounded-[10px] border border-border px-3 py-2.5" open={!plan.sections.some((s) => located.get(s.id)?.empty === false)}>
        <summary className="cursor-pointer font-medium">The plan</summary>
        {plan.researchQuestions.length > 0 && (
          <>
            <p className="mt-3 text-muted">Research questions</p>
            <ol className="mt-1 list-decimal pl-5">
              {plan.researchQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
          </>
        )}
        {plan.aims.length > 0 && (
          <>
            <p className="mt-3 text-muted">Aims</p>
            <ul className="mt-1 list-disc pl-5">
              {plan.aims.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 text-muted">
          {plan.timeframe} · {plan.length === "short" ? "short sections" : "full sections"}
        </p>
      </details>

      <ol className="grid gap-4">
        {plan.sections.map((s, i) => {
          const where = located.get(s.id);
          const active = writing && status.sectionId === s.id;
          return (
            <li key={s.id} className="border-t border-border pt-3">
              <div className="flex items-start justify-between gap-3">
                <button
                  className="text-left font-medium hover:underline"
                  disabled={!where}
                  onClick={() => where && editor.chain().focus().setTextSelection(where.from + 1).scrollIntoView().run()}
                >
                  {i + 1}. {s.heading}
                </button>
                <span className={`shrink-0 text-xs ${active ? "text-cite" : "text-muted"}`}>
                  {active ? "Writing…" : !where ? "Heading removed" : where.empty ? "Not written" : "Written"}
                </span>
              </div>
              <p className="mt-1 text-muted">{s.guidance}</p>
              {!writing &&
                (noteFor === s.id ? (
                  <div className="mt-2 grid gap-2">
                    <label htmlFor={`note-${s.id}`} className="sr-only">
                      What should change?
                    </label>
                    <input
                      id={`note-${s.id}`}
                      className="input min-h-10 text-sm"
                      placeholder="What should change? (optional)"
                      value={note}
                      maxLength={500}
                      onChange={(e) => setNote(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void redraft(s)}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button className="btn-primary min-h-9 px-3 text-sm" onClick={() => void redraft(s)}>
                        Redraft
                      </button>
                      <button className="btn-ghost min-h-9 px-3 text-sm" onClick={() => setNoteFor(null)}>
                        Cancel
                      </button>
                    </div>
                    <p className="text-xs text-muted">This replaces the text under this heading, including your edits.</p>
                  </div>
                ) : (
                  <button
                    className="btn-secondary mt-2 min-h-9 px-3 text-sm"
                    onClick={() => (where && !where.empty ? setNoteFor(s.id) : void redraft(s))}
                  >
                    {where && !where.empty ? "Redraft…" : "Write this section"}
                  </button>
                ))}
            </li>
          );
        })}
      </ol>
      <p className="mt-6 text-xs text-muted">
        Claude cites your library for claims about existing research. Choices only you can make, like sample sizes or budget figures, are left in [square brackets].
      </p>
    </div>
  );
}
