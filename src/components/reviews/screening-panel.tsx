"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import { formatAuthors } from "@/lib/paper-format";
import type { ReviewDetail, ReviewRecordDto } from "@/server/reviews";
import type { Step } from "./review-view";

type Filter = "pending" | "included" | "excluded";
const SOURCE_NAMES: Record<string, string> = { openalex: "OpenAlex", semantic_scholar: "Semantic Scholar", arxiv: "arXiv", pubmed: "PubMed" };

export function ScreeningPanel({
  data,
  running,
  onChange,
  onRun,
  refresh,
}: {
  data: ReviewDetail;
  running: boolean;
  onChange: (d: ReviewDetail) => void;
  onRun: (s: Step) => void;
  refresh: () => Promise<void>;
}) {
  const { review, records } = data;
  const [filter, setFilter] = useState<Filter>(records.some((r) => r.screening === "pending") ? "pending" : "included");
  const [error, setError] = useState<string | null>(null);
  const counts = {
    pending: records.filter((r) => r.screening === "pending").length,
    included: records.filter((r) => r.screening === "included").length,
    excluded: records.filter((r) => r.screening === "excluded").length,
  };
  const withSuggestion = records.filter((r) => r.screening === "pending" && r.ai).length;
  const toRetrieve = records.filter((r) => r.screening === "included" && (r.fullText === "not_requested" || r.fullText === "failed")).length;
  const shown = records.filter((r) => r.screening === filter);
  const isScreening = review.mode === "screening";

  function patchRecord(next: ReviewRecordDto) {
    onChange({ ...data, records: data.records.map((r) => (r.id === next.id ? next : r)) });
  }

  async function acceptAll() {
    setError(null);
    try {
      onChange(await api<ReviewDetail>(`/api/v1/reviews/${review.id}/accept-suggestions`, { method: "POST" }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      {isScreening && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {counts.pending > 0 && (
            <button className="btn-secondary" disabled={running} onClick={() => onRun("ai-screen")}>
              Ask Claude to suggest decisions
            </button>
          )}
          {withSuggestion > 0 && (
            <button className="btn-secondary" disabled={running} onClick={acceptAll}>
              Accept {withSuggestion} suggestions
            </button>
          )}
          {toRetrieve > 0 && (
            <button className="btn-primary" disabled={running} onClick={() => onRun("retrieve")}>
              Get the {toRetrieve} included {toRetrieve === 1 ? "study" : "studies"}
            </button>
          )}
          <p className="w-full text-sm text-muted">
            Claude&apos;s suggestions never decide on their own here: you include or exclude each paper, or accept the suggestions in bulk.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <div role="radiogroup" aria-label="Show records" className="mb-4 inline-flex rounded-[10px] bg-surface-2 p-1 text-sm">
        {(["pending", "included", "excluded"] as const).map((f) => (
          <button
            key={f}
            role="radio"
            aria-checked={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-9 rounded-[8px] px-3 ${filter === f ? "bg-surface font-medium text-text ring-1 ring-border" : "text-muted hover:text-text"}`}
          >
            {f === "pending" ? "To screen" : f === "included" ? "Included" : "Excluded"} <span className="tabular-nums">{counts[f]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-muted">
          {filter === "pending" ? "Every record has been screened." : filter === "included" ? "Nothing included yet." : "Nothing excluded yet."}
        </p>
      ) : (
        <ul className="border-b border-border">
          {shown.slice(0, 200).map((r) => (
            <RecordRow
              key={r.id}
              record={r}
              reviewId={review.id}
              reasons={review.criteria.exclude}
              editable={isScreening && !running}
              onSaved={patchRecord}
              onError={setError}
            />
          ))}
        </ul>
      )}
      {shown.length > 200 && <p className="mt-3 text-sm text-muted">Showing the first 200. Screen these to see the rest.</p>}
      <button className="sr-only" onClick={() => void refresh()}>
        Refresh records
      </button>
    </div>
  );
}

function RecordRow({
  record: r,
  reviewId,
  reasons,
  editable,
  onSaved,
  onError,
}: {
  record: ReviewRecordDto;
  reviewId: string;
  reasons: string[];
  editable: boolean;
  onSaved: (r: ReviewRecordDto) => void;
  onError: (e: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [excluding, setExcluding] = useState(false);
  const [busy, setBusy] = useState(false);

  async function decide(screening: "included" | "excluded" | "pending", reason?: string) {
    setBusy(true);
    try {
      const { record } = await api<{ record: ReviewRecordDto }>(`/api/v1/reviews/${reviewId}/records/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ screening, reason }),
      });
      setExcluding(false);
      onSaved(record);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const byline = [formatAuthors(r.authors, 3), r.year, r.venue].filter(Boolean).join(", ");
  const link = r.doi ? `https://doi.org/${r.doi}` : r.url;

  return (
    <li className="border-t border-border py-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-8">
        <div className="min-w-0">
          <p className="text-[17px] font-medium break-words">
            {link ? (
              <a href={link} target="_blank" rel="noreferrer" className="hover:underline">
                {r.title}
              </a>
            ) : (
              r.title
            )}
          </p>
          {byline && <p className="mt-1 text-sm text-muted">{byline}</p>}
          <p className="mt-1 text-xs text-muted">
            Found in {r.sources.map((s) => SOURCE_NAMES[s] ?? s).join(", ")}
            {r.openAccess ? ", open access" : ""}
          </p>
          {r.abstract && (
            <div className="mt-3 max-w-[44rem]">
              <p className={`text-[15px] leading-relaxed whitespace-pre-line ${open ? "" : "line-clamp-3"}`}>{r.abstract}</p>
              <button className="mt-1 text-sm text-muted underline underline-offset-2 hover:text-text" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {open ? "Show less" : "Read the abstract"}
              </button>
            </div>
          )}
        </div>

        <div className="grid content-start gap-3">
          {r.ai && (
            <div className="rounded-[10px] bg-surface-2 px-3 py-2.5 text-sm">
              <p className="font-medium">
                Claude {r.screening !== "pending" && r.decidedBy === "ai" ? "decided" : "suggests"}: {r.ai.decision === "include" ? "include" : "exclude"}
                <span className="ml-1 font-normal text-muted tabular-nums">({r.ai.relevance}/100 relevant)</span>
              </p>
              <p className="mt-1 text-muted">{r.ai.reason}</p>
            </div>
          )}
          {r.screening === "excluded" && r.exclusionReason && (
            <p className="text-sm">
              <span className="text-muted">Excluded: </span>
              {r.exclusionReason}
            </p>
          )}
          {r.fullText !== "not_requested" && (
            <p className="text-sm text-muted">
              {r.fullText === "retrieved"
                ? "Full text in your library"
                : r.fullText === "abstract_only"
                  ? r.openAccess
                    ? "Abstract only (the full text couldn't be downloaded)"
                    : "Abstract only (no open-access version)"
                  : r.fullText === "pending"
                    ? "Reading…"
                    : "Couldn't be read"}
            </p>
          )}
          {editable && !excluding && (
            <div className="flex flex-wrap gap-2">
              {r.screening !== "included" && (
                <button className="btn-primary min-h-10 px-4 text-sm" disabled={busy} onClick={() => decide("included")}>
                  Include
                </button>
              )}
              {r.screening !== "excluded" && (
                <button className="btn-secondary min-h-10 px-4 text-sm" disabled={busy} onClick={() => setExcluding(true)}>
                  Exclude
                </button>
              )}
              {r.screening !== "pending" && r.fullText === "not_requested" && (
                <button className="btn-ghost min-h-10 px-3 text-sm" disabled={busy} onClick={() => decide("pending")}>
                  Undo
                </button>
              )}
            </div>
          )}
          {editable && excluding && (
            <div className="grid gap-2" role="group" aria-label="Reason for excluding">
              <p className="text-sm font-medium">Why exclude it?</p>
              {[...reasons, ...(r.ai?.decision === "exclude" ? [r.ai.reason] : []), "Not relevant to the question"].slice(0, 7).map((reason) => (
                <button key={reason} className="btn-secondary min-h-9 justify-start px-3 text-left text-sm" disabled={busy} onClick={() => decide("excluded", reason)}>
                  {reason}
                </button>
              ))}
              <button className="btn-ghost min-h-9 px-3 text-sm" onClick={() => setExcluding(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
