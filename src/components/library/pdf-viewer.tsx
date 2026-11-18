"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import { squash } from "@/lib/chat/highlight";

// Must be set in the module that renders <Document> (see react-pdf docs).
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** One page at a time, with the cited passage marked in the text layer. */
export function PdfViewer({ paperId, initialPage, highlight }: { paperId: string; initialPage: number; highlight: string }) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [page, setPage] = useState(initialPage);
  const [width, setWidth] = useState(800);
  const box = useRef<HTMLDivElement>(null);
  const file = useMemo(() => ({ url: `/api/v1/papers/${paperId}/file` }), [paperId]);
  const wanted = useMemo(() => squash(highlight), [highlight]);
  const highlightThisPage = page === initialPage && wanted.length >= 8;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.min(900, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const renderText = useCallback(
    ({ str }: { str: string }) => {
      const safe = escapeHtml(str);
      const piece = squash(str);
      // A text item is one line or fragment: mark it when it's part of the quote,
      // or when the (short) quote sits inside it.
      const hit = piece.length >= 3 && (wanted.includes(piece) || (wanted.length >= 12 && piece.includes(wanted)));
      return highlightThisPage && hit ? `<mark class="pdf-cited">${safe}</mark>` : safe;
    },
    [highlightThisPage, wanted],
  );

  const scrollToMark = useCallback(() => {
    box.current?.querySelector("mark.pdf-cited")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const go = (n: number) => setPage(Math.min(Math.max(1, n), pageCount ?? n));

  return (
    <div className="rounded-[14px] border border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm">
        <span className="text-muted" aria-live="polite">
          Page {page}
          {pageCount ? ` of ${pageCount}` : ""}
        </span>
        <div className="flex items-center gap-2">
          <button className="btn-secondary min-h-9 px-3 text-sm" onClick={() => go(page - 1)} disabled={page <= 1}>
            Previous
          </button>
          <label className="sr-only" htmlFor="page-input">
            Go to page
          </label>
          <input
            id="page-input"
            name="page"
            type="number"
            inputMode="numeric"
            min={1}
            max={pageCount ?? undefined}
            value={page}
            onChange={(e) => go(Number(e.target.value) || 1)}
            className="input min-h-9 w-20 text-center text-sm"
          />
          <button className="btn-secondary min-h-9 px-3 text-sm" onClick={() => go(page + 1)} disabled={pageCount !== null && page >= pageCount}>
            Next
          </button>
        </div>
      </div>
      <div ref={box} className="flex justify-center overflow-hidden bg-surface-2 p-4">
        <Document
          file={file}
          suspense={false}
          onLoadSuccess={(doc) => setPageCount(doc.numPages)}
          loading={<p className="p-10 text-muted">Loading PDF…</p>}
          error={<p className="p-10 text-danger">Couldn&apos;t load this PDF.</p>}
        >
          <Page
            pageNumber={page}
            width={width}
            renderAnnotationLayer={false}
            customTextRenderer={renderText}
            onRenderTextLayerSuccess={scrollToMark}
            loading={<div style={{ width, height: width * 1.3 }} className="bg-surface" />}
            className="shadow-[0_0_0_1px_var(--border)]"
          />
        </Document>
      </div>
    </div>
  );
}
