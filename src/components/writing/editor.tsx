"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClaimCheck } from "@/db/schema";
import { api } from "@/lib/client-api";
import type { CitationItem, DocNode } from "@/lib/writing/doc";
import { CitationContext, CitationNode, type CitablePaper } from "./citation-node";
import { CitationDialog, type CitationDialogState } from "./citation-dialog";
import { ClaimChecks } from "./claim-checks";
import { DraftDialog } from "./draft-dialog";

type Rendered = { labels: Record<string, string>; bibliography: { html: string; text: string }[] };
type SaveState = "saved" | "saving" | "unsaved" | "error";

const STYLES = [
  { id: "apa", label: "APA 7th" },
  { id: "modern-language-association", label: "MLA 9th" },
  { id: "chicago-author-date", label: "Chicago (author-date)" },
  { id: "ieee", label: "IEEE" },
  { id: "vancouver", label: "Vancouver" },
  { id: "harvard-cite-them-right", label: "Harvard" },
];

const EXPORTS = [
  { format: "docx", label: "Word (.docx)" },
  { format: "pdf", label: "PDF" },
  { format: "latex", label: "LaTeX (.tex + .bib)" },
  { format: "markdown", label: "Markdown" },
  { format: "bibtex", label: "BibTeX references" },
];

export function WritingEditor({
  doc,
  papers,
}: {
  doc: { id: string; title: string; content: DocNode; citationStyle: string; checks: ClaimCheck[] | null; checkedAt: string | null };
  papers: CitablePaper[];
}) {
  const [title, setTitle] = useState(doc.title);
  const [style, setStyle] = useState(doc.citationStyle);
  const [rendered, setRendered] = useState<Rendered>({ labels: {}, bibliography: [] });
  const [save, setSave] = useState<SaveState>("saved");
  const [dialog, setDialog] = useState<CitationDialogState | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [checks, setChecks] = useState<ClaimCheck[] | null>(doc.checks);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"references" | "checks">(doc.checks?.length ? "checks" : "references");
  const paperMap = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Record<string, unknown>>({});

  const flush = useCallback(async () => {
    const body = pending.current;
    pending.current = {};
    if (!Object.keys(body).length) return;
    setSave("saving");
    try {
      await api(`/api/v1/documents/${doc.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setSave(Object.keys(pending.current).length ? "unsaved" : "saved");
    } catch {
      pending.current = { ...body, ...pending.current };
      setSave("error");
    }
  }, [doc.id]);

  const queueSave = useCallback(
    (patch: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...patch };
      setSave("unsaved");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  const renderCitations = useCallback(
    (content: DocNode, citationStyle: string) => {
      if (renderTimer.current) clearTimeout(renderTimer.current);
      renderTimer.current = setTimeout(async () => {
        try {
          setRendered(await api<Rendered>("/api/v1/citations/render", { method: "POST", body: JSON.stringify({ content, style: citationStyle }) }));
        } catch {
          // keep the previous labels
        }
      }, 300);
    },
    [],
  );

  const styleRef = useRef(style);
  useEffect(() => {
    styleRef.current = style;
  }, [style]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] }, link: false, underline: false }), CitationNode],
    content: doc.content,
    editorProps: { attributes: { class: "focus:outline-none", "aria-label": "Document text" } },
    onUpdate: ({ editor, transaction }) => {
      const json = editor.getJSON() as DocNode;
      queueSave({ content: json });
      if (transaction.steps.some((s) => JSON.stringify(s).includes("citation"))) renderCitations(json, styleRef.current);
    },
  });

  // First render of labels, and after the style changes.
  useEffect(() => {
    if (editor) renderCitations(editor.getJSON() as DocNode, style);
  }, [editor, style, renderCitations]);

  // Save before leaving.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [flush]);

  const onEditCitation = useCallback((pos: number, attrs: { id: string; items: CitationItem[] }) => setDialog({ mode: "edit", pos, attrs }), []);

  function applyCitation(state: CitationDialogState, items: CitationItem[]) {
    if (!editor) return;
    if (state.mode === "edit") {
      const chain = editor.chain().focus();
      if (!items.length) chain.deleteRange({ from: state.pos, to: state.pos + 1 }).run();
      else chain.command(({ tr }) => (tr.setNodeMarkup(state.pos, undefined, { ...state.attrs, items }), true)).run();
    } else if (items.length) {
      editor.chain().focus().insertContent({ type: "citation", attrs: { id: crypto.randomUUID(), items } }).run();
    }
    setDialog(null);
    renderCitations(editor.getJSON() as DocNode, style);
  }

  async function runCheck() {
    setChecking(true);
    setCheckError(null);
    setPanel("checks");
    try {
      await flush();
      const res = await api<{ checks: ClaimCheck[] }>(`/api/v1/documents/${doc.id}/check`, { method: "POST" });
      setChecks(res.checks);
    } catch (err) {
      setCheckError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <CitationContext.Provider value={{ labels: rendered.labels, papers: paperMap, onEdit: onEditCitation }}>
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/app/writing" className="text-sm text-muted hover:text-text">
            ← Writing
          </Link>
          <span className="text-sm text-muted" aria-live="polite">
            {save === "saved" ? "Saved" : save === "saving" ? "Saving…" : save === "error" ? "Couldn't save. Retrying when you type." : "Unsaved changes"}
          </span>
        </div>

        <label htmlFor="doc-title" className="sr-only">
          Title
        </label>
        <input
          id="doc-title"
          name="title"
          value={title}
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value);
            if (e.target.value.trim()) queueSave({ title: e.target.value.trim() });
          }}
          className="mt-4 w-full bg-transparent text-3xl font-semibold tracking-[-0.02em] outline-none placeholder:text-muted"
          placeholder="Untitled document"
        />

        <Toolbar
          editor={editor}
          style={style}
          onStyle={(s) => {
            setStyle(s);
            queueSave({ citationStyle: s });
          }}
          onCite={() => setDialog({ mode: "insert" })}
          onDraft={() => setDrafting(true)}
          onCheck={runCheck}
          checking={checking}
          docId={doc.id}
          beforeExport={flush}
        />

        <div className="mt-6 grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,44rem)_1fr]">
          <div className="doc-editor min-w-0">
            <EditorContent editor={editor} />
          </div>

          <aside aria-label="References and checks" className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:border-l lg:border-border lg:pl-8">
            <div role="tablist" aria-label="Margin" className="mb-4 inline-flex rounded-[10px] bg-surface-2 p-1 text-sm">
              {(["references", "checks"] as const).map((p) => (
                <button
                  key={p}
                  role="tab"
                  aria-selected={panel === p}
                  onClick={() => setPanel(p)}
                  className={`min-h-9 rounded-[8px] px-3 ${panel === p ? "bg-surface font-medium text-text ring-1 ring-border" : "text-muted hover:text-text"}`}
                >
                  {p === "references" ? `References (${rendered.bibliography.length})` : `Claim check${checks ? ` (${checks.length})` : ""}`}
                </button>
              ))}
            </div>
            {panel === "references" ? (
              rendered.bibliography.length ? (
                <ol className="doc-bibliography text-[15px] leading-relaxed">
                  {rendered.bibliography.map((b, i) => (
                    <li key={i} dangerouslySetInnerHTML={{ __html: b.html }} />
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">
                  References appear here as you cite papers. Use <strong>Cite</strong> in the toolbar, or let Claude draft a paragraph with citations.
                </p>
              )
            ) : (
              <ClaimChecks editor={editor} checks={checks} checking={checking} error={checkError} papers={paperMap} onRun={runCheck} />
            )}
          </aside>
        </div>
      </div>

      {dialog && editor && (
        <CitationDialog state={dialog} papers={papers} onApply={(items) => applyCitation(dialog, items)} onClose={() => setDialog(null)} />
      )}
      {drafting && editor && (
        <DraftDialog
          docId={doc.id}
          papers={papers}
          onClose={() => setDrafting(false)}
          onInsert={(nodes) => {
            editor.chain().focus().insertContent(nodes).run();
            setDrafting(false);
            renderCitations(editor.getJSON() as DocNode, style);
          }}
        />
      )}
    </CitationContext.Provider>
  );
}

function Toolbar({
  editor,
  style,
  onStyle,
  onCite,
  onDraft,
  onCheck,
  checking,
  docId,
  beforeExport,
}: {
  editor: Editor | null;
  style: string;
  onStyle: (s: string) => void;
  onCite: () => void;
  onDraft: () => void;
  onCheck: () => void;
  checking: boolean;
  docId: string;
  beforeExport: () => Promise<void>;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            h2: e.isActive("heading", { level: 2 }),
            h3: e.isActive("heading", { level: 3 }),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
          }
        : null,
  });
  const [exportOpen, setExportOpen] = useState(false);
  const btn = (active: boolean | undefined) =>
    `inline-flex min-h-10 min-w-10 items-center justify-center rounded-[8px] px-2.5 text-sm transition-colors duration-150 ${active ? "bg-accent-soft font-semibold text-accent" : "text-text hover:bg-surface-2"}`;
  const run = (fn: (e: Editor) => void) => () => editor && fn(editor);

  return (
    <div role="toolbar" aria-label="Formatting and tools" className="sticky top-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-1 border-y border-border bg-bg/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-[12px] sm:border sm:px-2">
      <button className={btn(state?.h2)} aria-pressed={state?.h2} onClick={run((e) => e.chain().focus().toggleHeading({ level: 2 }).run())} title="Heading">
        H2
      </button>
      <button className={btn(state?.h3)} aria-pressed={state?.h3} onClick={run((e) => e.chain().focus().toggleHeading({ level: 3 }).run())} title="Subheading">
        H3
      </button>
      <button className={btn(state?.bold)} aria-pressed={state?.bold} onClick={run((e) => e.chain().focus().toggleBold().run())} title="Bold">
        <strong>B</strong>
      </button>
      <button className={btn(state?.italic)} aria-pressed={state?.italic} onClick={run((e) => e.chain().focus().toggleItalic().run())} title="Italic">
        <em className="font-serif">I</em>
      </button>
      <button className={btn(state?.bullet)} aria-pressed={state?.bullet} onClick={run((e) => e.chain().focus().toggleBulletList().run())} title="Bulleted list">
        • List
      </button>
      <button className={btn(state?.ordered)} aria-pressed={state?.ordered} onClick={run((e) => e.chain().focus().toggleOrderedList().run())} title="Numbered list">
        1. List
      </button>
      <button className={btn(state?.quote)} aria-pressed={state?.quote} onClick={run((e) => e.chain().focus().toggleBlockquote().run())} title="Quote">
        “ ”
      </button>
      <span aria-hidden className="mx-1 h-6 w-px bg-border" />
      <button className="btn-secondary min-h-10 px-3 text-sm" onClick={onCite}>
        Cite
      </button>
      <button className="btn-secondary min-h-10 px-3 text-sm" onClick={onDraft}>
        Draft with Claude
      </button>
      <button className="btn-secondary min-h-10 px-3 text-sm" onClick={onCheck} disabled={checking}>
        {checking ? "Checking…" : "Check claims"}
      </button>
      <span className="ml-auto flex items-center gap-2">
        <label htmlFor="style" className="sr-only">
          Citation style
        </label>
        <select id="style" name="style" value={style} onChange={(e) => onStyle(e.target.value)} className="input min-h-10 w-auto py-0 text-sm">
          {STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="relative">
          <button className="btn-primary min-h-10 px-3 text-sm" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)}>
            Export
          </button>
          {exportOpen && (
            <div role="menu" className="panel absolute right-0 z-20 mt-2 w-56 p-1 shadow-lg" onMouseLeave={() => setExportOpen(false)}>
              {EXPORTS.map((x) => (
                <button
                  key={x.format}
                  role="menuitem"
                  className="block w-full rounded-[8px] px-3 py-2 text-left text-sm hover:bg-surface-2"
                  onClick={async () => {
                    setExportOpen(false);
                    await beforeExport();
                    const a = document.createElement("a");
                    a.href = `/api/v1/documents/${docId}/export?format=${x.format}`;
                    a.download = "";
                    a.click();
                  }}
                >
                  {x.label}
                </button>
              ))}
            </div>
          )}
        </span>
      </span>
    </div>
  );
}
