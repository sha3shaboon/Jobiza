"use client";

import { useEffect, useRef, useState } from "react";
import type { PaperSummary } from "@/server/library";

/** Choose which papers a conversation answers from (none selected = whole library). */
export function ScopePicker({
  papers,
  value,
  onChange,
}: {
  papers: PaperSummary[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const label =
    value.length === 0
      ? `All papers (${papers.length})`
      : value.length === 1
        ? (papers.find((p) => p.id === value[0])?.title ?? "1 paper")
        : `${value.length} papers`;

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        className="btn-secondary min-h-10 max-w-[18rem] px-3 text-sm"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        disabled={papers.length === 0}
      >
        <span className="text-muted">Asking:</span>
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Choose papers" className="panel absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] p-2 shadow-lg">
          <button
            type="button"
            className={`w-full rounded-[8px] px-3 py-2 text-left text-sm ${value.length === 0 ? "bg-surface-2 font-medium" : "hover:bg-surface-2"}`}
            onClick={() => onChange([])}
          >
            All papers in your library
          </button>
          <ul className="mt-1 max-h-72 overflow-y-auto border-t border-border pt-1">
            {papers.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] px-3 py-2 text-sm hover:bg-surface-2">
                  <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
                  <span className="min-w-0 break-words">{p.title}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
