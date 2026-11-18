"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import type { ReviewDetail } from "@/server/reviews";
import type { Step } from "./review-view";

const SOURCES = [
  { id: "openalex", label: "OpenAlex", note: "All disciplines" },
  { id: "semantic_scholar", label: "Semantic Scholar", note: "All disciplines" },
  { id: "arxiv", label: "arXiv", note: "Preprints: CS, physics, maths" },
  { id: "pubmed", label: "PubMed", note: "Biomedicine and health" },
] as const;

/** Edit one list of short strings (queries, criteria, columns). */
function ListEditor({ label, hint, items, onChange, placeholder, disabled }: {
  label: string;
  hint: string;
  items: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
    setDraft("");
  };
  return (
    <div>
      <p className="font-medium">{label}</p>
      <p className="mt-0.5 text-sm text-muted">{hint}</p>
      <ul className="mt-3 grid gap-2">
        {items.map((item, i) => (
          <li key={`${item}-${i}`} className="flex items-start gap-2 rounded-[10px] bg-surface-2 px-3 py-2 text-[15px]">
            <span className="min-w-0 flex-1 break-words">{item}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-sm text-muted hover:text-danger"
              aria-label={`Remove ${item}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <label className="sr-only" htmlFor={`add-${label}`}>
          Add to {label}
        </label>
        <input
          id={`add-${label}`}
          name={`add-${label}`}
          className="input min-h-10 text-[15px]"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn-secondary min-h-10 px-4 text-sm" onClick={add} disabled={disabled || !draft.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

export function SetupPanel({
  data,
  running,
  onChange,
  onRun,
}: {
  data: ReviewDetail;
  running: boolean;
  onChange: (d: ReviewDetail) => void;
  onRun: (s: Step) => void;
}) {
  const { review, records } = data;
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = running || review.mode === "agentic";

  async function save(patch: Record<string, unknown>) {
    setError(null);
    try {
      onChange(await api<ReviewDetail>(`/api/v1/reviews/${review.id}`, { method: "PATCH", body: JSON.stringify(patch) }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      onChange(await api<ReviewDetail>(`/api/v1/reviews/${review.id}/plan`, { method: "POST" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  const years = review.criteria;
  const setYear = (key: "yearFrom" | "yearTo", value: string) => {
    const n = Number(value);
    const next = { ...years, [key]: value && Number.isInteger(n) ? n : undefined };
    void save({ criteria: next });
  };

  return (
    <div className="grid gap-10">
      {review.mode === "agentic" ? (
        <p className="max-w-2xl text-muted">Jobiza planned this review. Here are the queries and criteria it used.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-secondary" onClick={suggest} disabled={running || suggesting}>
            {suggesting ? "Thinking…" : review.queries.length ? "Suggest again with Claude" : "Suggest queries and criteria"}
          </button>
          <p className="text-sm text-muted">Claude drafts them from your question. You can edit everything.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid gap-10 lg:grid-cols-2">
        <ListEditor
          label="Search queries"
          hint="Each runs on every source you pick. Plain keywords work best."
          items={review.queries}
          onChange={(queries) => save({ queries })}
          placeholder="sleep deprivation memory adolescents"
          disabled={readOnly}
        />
        <div>
          <p className="font-medium">Sources</p>
          <p className="mt-0.5 text-sm text-muted">Results are merged and duplicates removed.</p>
          <div className="mt-3 grid gap-2">
            {SOURCES.map((s) => {
              const on = review.sources.includes(s.id);
              return (
                <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-border px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    checked={on}
                    disabled={readOnly || (on && review.sources.length === 1)}
                    onChange={() => save({ sources: on ? review.sources.filter((x) => x !== s.id) : [...review.sources, s.id] })}
                  />
                  <span className="font-medium">{s.label}</span>
                  <span className="text-sm text-muted">{s.note}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="yearFrom" className="label">
                From year
              </label>
              <input id="yearFrom" name="yearFrom" type="number" inputMode="numeric" className="input w-28" defaultValue={years.yearFrom ?? ""} disabled={readOnly} onBlur={(e) => setYear("yearFrom", e.target.value)} />
            </div>
            <div>
              <label htmlFor="yearTo" className="label">
                To year
              </label>
              <input id="yearTo" name="yearTo" type="number" inputMode="numeric" className="input w-28" defaultValue={years.yearTo ?? ""} disabled={readOnly} onBlur={(e) => setYear("yearTo", e.target.value)} />
            </div>
          </div>
        </div>
        <ListEditor
          label="Include studies that…"
          hint="Used for screening by you and by Claude."
          items={review.criteria.include}
          onChange={(include) => save({ criteria: { ...review.criteria, include } })}
          placeholder="Participants aged 10 to 19"
          disabled={readOnly}
        />
        <ListEditor
          label="Exclude studies that…"
          hint="Offered as reasons when you exclude a paper."
          items={review.criteria.exclude}
          onChange={(exclude) => save({ criteria: { ...review.criteria, exclude } })}
          placeholder="Animal studies"
          disabled={readOnly}
        />
        <ListEditor
          label="Comparison table columns"
          hint="Filled in for each included study."
          items={review.matrixColumns}
          onChange={(matrixColumns) => save({ matrixColumns })}
          placeholder="Sample size"
          disabled={readOnly}
        />
      </div>

      {review.mode === "screening" && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
          <button className="btn-primary" disabled={running || !review.queries.length} onClick={() => onRun("search")}>
            {records.length ? "Search again" : "Run the search"}
          </button>
          <p className="text-sm text-muted">
            {records.length
              ? "Searching again keeps your decisions and replaces records you haven't screened."
              : "Finds up to 25 results per query on each source."}
          </p>
        </div>
      )}
    </div>
  );
}
