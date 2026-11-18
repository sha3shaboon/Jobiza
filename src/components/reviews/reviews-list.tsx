"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client-api";
import type { listReviews } from "@/server/reviews";

type Summary = Awaited<ReturnType<typeof listReviews>>[number];

const MODES = [
  {
    id: "agentic",
    title: "Research it for me",
    body: "Jobiza plans the searches, screens hundreds of abstracts, reads the most relevant studies and writes a cited synthesis. Takes a few minutes.",
  },
  {
    id: "screening",
    title: "I'll screen the papers",
    body: "You set the criteria and decide on every paper, with Claude's suggestions alongside. Keeps a PRISMA log for systematic reviews.",
  },
] as const;

export const STATUS_TEXT: Record<string, string> = {
  draft: "Draft",
  searching: "Searching",
  screening: "Screening",
  retrieving: "Reading studies",
  extracting: "Filling table",
  synthesizing: "Writing synthesis",
  ready: "Ready",
  failed: "Needs attention",
};

export function ReviewsList({ initialReviews }: { initialReviews: Summary[] }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"agentic" | "screening">("agentic");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { review } = await api<{ review: { id: string } }>("/api/v1/reviews", {
        method: "POST",
        body: JSON.stringify({ question, mode }),
      });
      router.push(`/app/reviews/${review.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-semibold tracking-[-0.02em]">Literature reviews</h1>
      <p className="mt-2 text-lg text-muted">Search OpenAlex, Semantic Scholar, arXiv and PubMed, and turn what you find into a cited synthesis.</p>

      <form onSubmit={create} className="mt-8 rounded-[14px] border border-border p-6">
        <label htmlFor="question" className="text-lg font-medium">
          What&apos;s your research question?
        </label>
        <textarea
          id="question"
          name="question"
          rows={2}
          required
          minLength={10}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Does sleep deprivation affect memory consolidation in adolescents?"
          className="input mt-3 resize-y py-3"
        />
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-medium">How do you want to work?</legend>
          <div className="grid gap-3 md:grid-cols-2">
            {MODES.map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer gap-3 rounded-[12px] border p-4 transition-colors duration-150 ${mode === m.id ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2"}`}
              >
                <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-1 accent-[var(--accent)]" />
                <span>
                  <span className="block font-medium">{m.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted">{m.body}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="mt-4 rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        <button className="btn-primary mt-5" disabled={busy || question.trim().length < 10}>
          {busy ? "Starting…" : mode === "agentic" ? "Start researching" : "Set up the review"}
        </button>
      </form>

      <section aria-labelledby="past" className="mt-12">
        <h2 id="past" className="text-xl font-semibold">
          Your reviews
        </h2>
        {initialReviews.length === 0 ? (
          <p className="mt-3 text-muted">Reviews you start will be listed here.</p>
        ) : (
          <ul className="mt-4 border-b border-border">
            {initialReviews.map((r) => (
              <li key={r.id} className="grid gap-2 border-t border-border py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                <div className="min-w-0">
                  <Link href={`/app/reviews/${r.id}`} className="text-lg font-medium break-words hover:underline">
                    {r.title}
                  </Link>
                  <p className="mt-1 text-sm text-muted">
                    {r.mode === "agentic" ? "Researched by Jobiza" : "Screened by you"}
                    {r.records ? `, ${r.records} records, ${r.included} included` : ""}
                  </p>
                </div>
                <span className={`justify-self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${r.status === "ready" ? "bg-accent-soft text-accent" : r.status === "failed" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted"}`}>
                  {STATUS_TEXT[r.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
