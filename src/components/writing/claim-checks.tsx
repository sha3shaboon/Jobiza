"use client";

import type { Editor } from "@tiptap/react";
import Link from "next/link";
import type { ClaimCheck } from "@/db/schema";
import type { CitablePaper } from "./citation-node";

const VERDICT: Record<ClaimCheck["verdict"], { label: string; tone: string }> = {
  supported: { label: "Supported", tone: "bg-accent-soft text-accent" },
  partly_supported: { label: "Partly supported", tone: "bg-[#fdf1d8] text-[#7a4b00] dark:bg-[#3a2e14] dark:text-[#f2c56b]" },
  not_supported: { label: "Not supported", tone: "bg-danger-soft text-danger" },
  needs_citation: { label: "Needs a citation", tone: "bg-[#fdf1d8] text-[#7a4b00] dark:bg-[#3a2e14] dark:text-[#f2c56b]" },
  cannot_verify: { label: "Couldn't verify", tone: "bg-surface-2 text-muted" },
};

const ORDER: ClaimCheck["verdict"][] = ["not_supported", "needs_citation", "partly_supported", "cannot_verify", "supported"];

/** Find a sentence's text in the editor; returns its document range. */
export function findSentence(editor: Editor, sentence: string): { from: number; to: number } | null {
  const probe = sentence.replace(/[.!?]+$/, "").slice(0, 60).toLowerCase();
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isTextblock) return !found;
    // Map text offsets to positions, treating citation nodes as zero-width.
    let text = "";
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) for (let i = 0; i < child.text!.length; i++) {
        text += child.text![i];
        map.push(pos + 1 + offset + i);
      }
    });
    const at = text.toLowerCase().indexOf(probe);
    if (at >= 0) {
      const endText = text.slice(at).search(/[.!?](\s|$)/);
      const endIndex = endText >= 0 ? at + endText : at + probe.length - 1;
      found = { from: map[at], to: map[Math.min(endIndex, map.length - 1)] + 1 };
    }
    return false;
  });
  return found;
}

export function ClaimChecks({
  editor,
  checks,
  checking,
  error,
  papers,
  onRun,
}: {
  editor: Editor | null;
  checks: ClaimCheck[] | null;
  checking: boolean;
  error: string | null;
  papers: Map<string, CitablePaper>;
  onRun: () => void;
}) {
  if (checking) return <p className="text-sm text-muted" aria-live="polite">Reading your sources and checking each claim…</p>;
  if (error)
    return (
      <p role="alert" className="rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
        {error}
      </p>
    );
  if (!checks)
    return (
      <div className="text-sm text-muted">
        <p>Claude checks each cited sentence against the passages it cites, and flags claims that need a citation.</p>
        <p className="mt-2">Evidence quotes are verified against the source text before they&apos;re shown.</p>
        <button className="btn-secondary mt-4" onClick={onRun}>
          Check claims
        </button>
      </div>
    );
  if (!checks.length) return <p className="text-sm text-muted">Nothing to flag: every checked claim is supported or doesn&apos;t need a citation.</p>;

  const sorted = [...checks].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict));

  function select(c: ClaimCheck) {
    if (!editor) return;
    const range = findSentence(editor, c.sentence);
    if (!range) return;
    editor.chain().focus().setTextSelection(range).scrollIntoView().run();
  }

  function addCitation(c: ClaimCheck) {
    if (!editor || !c.suggestion) return;
    const range = findSentence(editor, c.sentence);
    if (!range) return;
    // Insert before the sentence's final punctuation.
    const lastChar = editor.state.doc.textBetween(range.to - 1, range.to);
    const at = /[.!?]/.test(lastChar) ? range.to - 1 : range.to;
    editor
      .chain()
      .focus()
      .insertContentAt(at, { type: "citation", attrs: { id: crypto.randomUUID(), items: [{ paperId: c.suggestion.paperId, locator: String(c.suggestion.page) }] } })
      .run();
  }

  return (
    <ol className="grid gap-5">
      {sorted.map((c) => {
        const v = VERDICT[c.verdict];
        const ev = c.evidence ?? c.suggestion;
        return (
          <li key={c.id} className="text-sm leading-relaxed">
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${v.tone}`}>{v.label}</span>
            <button className="mt-1.5 block text-left text-[15px] hover:underline" onClick={() => select(c)} title="Show in the document">
              “{c.sentence}”
            </button>
            <p className="mt-1 text-muted">{c.explanation}</p>
            {ev && (
              <div className="mt-2 rounded-[10px] bg-surface-2 px-3 py-2">
                <p className="italic">“{ev.quote}”</p>
                <Link href={`/app/library/${ev.paperId}?${new URLSearchParams({ page: String(ev.page), hl: ev.quote })}`} className="link mt-1 inline-block text-muted">
                  {papers.get(ev.paperId)?.title ?? ev.paperTitle}, p. {ev.page}
                </Link>
              </div>
            )}
            {c.verdict === "needs_citation" && c.suggestion && (
              <button className="btn-secondary mt-2 min-h-9 px-3 text-sm" onClick={() => addCitation(c)}>
                Add this citation
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
