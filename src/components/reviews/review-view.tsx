"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Answer } from "@/components/ask/answer";
import { api } from "@/lib/client-api";
import type { ReviewDetail } from "@/server/reviews";
import { STATUS_TEXT } from "./reviews-list";
import { PrismaPanel } from "./prisma-panel";
import { ScreeningPanel } from "./screening-panel";
import { SetupPanel } from "./setup-panel";
import { StudiesTable } from "./studies-table";

const RUNNING = ["searching", "screening", "retrieving", "extracting", "synthesizing"];
type Tab = "setup" | "screening" | "studies" | "synthesis" | "prisma";

export type Step = "run" | "search" | "ai-screen" | "retrieve" | "extract" | "synthesize";

export function ReviewView({ initial }: { initial: ReviewDetail }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const { review, records } = data;
  const running = RUNNING.includes(review.status);
  const included = records.filter((r) => r.screening === "included");
  const readable = included.filter((r) => r.fullText === "retrieved" || r.fullText === "abstract_only");
  const [tab, setTab] = useState<Tab>(() => {
    if (review.synthesis) return "synthesis";
    if (review.mode === "screening" && records.length === 0) return "setup";
    return review.mode === "screening" ? "screening" : "prisma";
  });

  const refresh = useCallback(async () => {
    setData(await api<ReviewDetail>(`/api/v1/reviews/${review.id}`));
  }, [review.id]);

  // Poll while a step runs in the background.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refresh().catch(() => undefined), 2500);
    return () => clearInterval(t);
  }, [running, refresh]);

  // Jump to the result when an agentic review finishes.
  const [wasRunning, setWasRunning] = useState(running);
  if (wasRunning !== running) {
    setWasRunning(running);
    if (!running && review.synthesis) setTab("synthesis");
  }

  async function runStep(step: Step) {
    setError(null);
    try {
      setData(await api<ReviewDetail>(`/api/v1/reviews/${review.id}/steps`, { method: "POST", body: JSON.stringify({ step }) }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const tabs: { id: Tab; label: string; count?: number; show: boolean }[] = [
    { id: "setup", label: "Setup", show: true },
    { id: "screening", label: "Screening", count: records.length, show: records.length > 0 },
    { id: "studies", label: "Studies", count: included.length, show: included.length > 0 },
    { id: "synthesis", label: "Synthesis", show: Boolean(review.synthesis) || readable.length > 0 },
    { id: "prisma", label: "PRISMA & log", show: true },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/app/reviews" className="text-sm text-muted hover:text-text">
        ← Literature reviews
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-[-0.015em] break-words sm:text-3xl">{review.title}</h1>
          <p className="mt-2 text-muted">{review.question}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${review.status === "ready" ? "bg-accent-soft text-accent" : review.status === "failed" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted"}`}>
          {review.mode === "agentic" ? "Researched by Jobiza" : "Screened by you"}
        </span>
      </div>

      <Progress data={data} running={running} />

      {(review.status === "failed" || error) && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-[10px] bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{error ?? review.statusDetail}</span>
          {review.mode === "agentic" && review.status === "failed" && (
            <button className="btn-secondary min-h-9 px-3 text-sm" onClick={() => runStep("run")}>
              Try again
            </button>
          )}
        </div>
      )}
      {data.unavailableSources.length > 0 && !running && (
        <p className="mt-3 text-sm text-muted">
          Not searched this time: {data.unavailableSources.map((u) => u.reason).join(" ")}
        </p>
      )}

      <div role="tablist" aria-label="Review sections" className="mt-8 flex gap-1 overflow-x-auto border-b border-border">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px shrink-0 border-b-2 px-4 py-3 text-[15px] transition-colors duration-150 ${tab === t.id ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"}`}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1.5 text-sm text-muted tabular-nums">{t.count}</span>}
            </button>
          ))}
      </div>

      <div className="py-8" role="tabpanel">
        {tab === "setup" && <SetupPanel data={data} running={running} onChange={setData} onRun={runStep} />}
        {tab === "screening" && <ScreeningPanel data={data} running={running} onChange={setData} onRun={runStep} refresh={refresh} />}
        {tab === "studies" && <StudiesTable data={data} running={running} onRun={runStep} />}
        {tab === "synthesis" && (
          <section aria-label="Synthesis">
            {review.synthesis ? (
              <>
                <Answer content={review.synthesis} citations={review.synthesisCitations} pending={false} error={null} />
                {review.mode === "screening" && (
                  <button className="btn-secondary mt-8" disabled={running} onClick={() => runStep("synthesize")}>
                    Rewrite the synthesis
                  </button>
                )}
              </>
            ) : (
              <div className="max-w-xl">
                <p className="text-muted">
                  {readable.length} included {readable.length === 1 ? "study is" : "studies are"} ready. Jobiza will write a synthesis that cites the passages it uses.
                </p>
                <button className="btn-primary mt-4" disabled={running || !readable.length} onClick={() => runStep("synthesize")}>
                  Write the synthesis
                </button>
              </div>
            )}
          </section>
        )}
        {tab === "prisma" && <PrismaPanel data={data} />}
      </div>
    </div>
  );
}

/** Where the review is in its sequence, with live status while a step runs. */
function Progress({ data, running }: { data: ReviewDetail; running: boolean }) {
  const { review, records, prisma } = data;
  const steps = [
    { label: "Plan", done: review.queries.length > 0 },
    { label: "Search", done: records.length > 0, detail: records.length ? `${records.length} records` : undefined },
    { label: "Screen", done: records.length > 0 && prisma.awaitingScreening === 0, detail: records.length ? `${prisma.screened} of ${records.length}` : undefined },
    { label: "Read studies", done: prisma.includedInReview > 0, detail: prisma.soughtForRetrieval ? `${prisma.includedInReview} read` : undefined },
    { label: "Table", done: records.some((r) => r.matrix) },
    { label: "Synthesis", done: Boolean(review.synthesis) },
  ];
  return (
    <div className="mt-6">
      <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${s.done ? "bg-accent text-accent-fg" : "border border-border text-muted"}`}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span className={s.done ? "" : "text-muted"}>{s.label}</span>
            {s.detail && <span className="text-muted tabular-nums">({s.detail})</span>}
          </li>
        ))}
      </ol>
      {running && (
        <p className="mt-4 flex items-center gap-2 text-sm" aria-live="polite">
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-cite motion-reduce:animate-none" />
          {review.statusDetail ?? STATUS_TEXT[review.status]}…
        </p>
      )}
    </div>
  );
}
