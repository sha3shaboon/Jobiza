"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ScopePicker } from "@/components/ask/scope-picker";
import type { ProposalPlan, ProposalSection, ProposalType } from "@/db/schema";
import { api } from "@/lib/client-api";
import { PROPOSAL_TEMPLATES } from "@/lib/writing/proposal-templates";
import type { PaperSummary } from "@/server/library";

type ReviewOption = { id: string; title: string; question: string; included: number };
type Sources = "library" | "review" | "papers";

const TIMEFRAMES = ["3 months", "6 months", "12 months", "18 months", "2 years", "3 years"];

/**
 * Two steps: a short brief, then Claude's outline to adjust. Writing happens in
 * the editor, section by section, once the outline is accepted.
 */
export function ProposalWizard({ reviews, papers, initialReviewId }: { reviews: ReviewOption[]; papers: PaperSummary[]; initialReviewId: string | null }) {
  const router = useRouter();
  const fromReview = reviews.find((r) => r.id === initialReviewId);
  const [step, setStep] = useState<"brief" | "outline">("brief");
  const [type, setType] = useState<ProposalType>("thesis");
  const [topic, setTopic] = useState(fromReview?.title ?? "");
  const [question, setQuestion] = useState(fromReview?.question ?? "");
  const [field, setField] = useState("");
  const [timeframe, setTimeframe] = useState("12 months");
  const [length, setLength] = useState<"short" | "full">("full");
  const [sources, setSources] = useState<Sources>(fromReview ? "review" : "library");
  const [reviewId, setReviewId] = useState(fromReview?.id ?? reviews[0]?.id ?? "");
  const [scope, setScope] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [plan, setPlan] = useState<ProposalPlan | null>(null);
  const [busy, setBusy] = useState<"planning" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const brief = () => ({
    type,
    topic,
    question,
    field,
    timeframe,
    length,
    reviewId: sources === "review" && reviewId ? reviewId : null,
    scopePaperIds: sources === "papers" ? scope : [],
  });

  async function makePlan(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy("planning");
    setError(null);
    try {
      const res = await api<{ title: string; plan: ProposalPlan }>("/api/v1/proposals/plan", { method: "POST", body: JSON.stringify(brief()) });
      setTitle(res.title);
      setPlan(res.plan);
      setStep("outline");
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!plan) return;
    setBusy("creating");
    setError(null);
    try {
      const clean: ProposalPlan = {
        ...plan,
        researchQuestions: plan.researchQuestions.map((q) => q.trim()).filter(Boolean),
        aims: plan.aims.map((a) => a.trim()).filter(Boolean),
        sections: plan.sections.filter((s) => s.heading.trim()),
      };
      const { document } = await api<{ document: { id: string } }>("/api/v1/proposals", { method: "POST", body: JSON.stringify({ title, plan: clean }) });
      router.push(`/app/writing/${document.id}?write=all`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  const errorBox = error && (
    <p role="alert" className="mt-6 rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
      {error}
    </p>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/app/writing" className="text-sm text-muted hover:text-text">
        ← Writing
      </Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em]">New research proposal</h1>
      <ol className="mt-3 flex gap-6 text-sm" aria-label="Steps">
        <li className={step === "brief" ? "font-medium" : "text-muted"}>1. Your idea</li>
        <li className={step === "outline" ? "font-medium" : "text-muted"}>2. The plan</li>
        <li className="text-muted">3. Claude writes it</li>
      </ol>

      {step === "brief" ? (
        <form onSubmit={makePlan} className="mt-8 grid gap-7">
          <fieldset>
            <legend className="label">What kind of proposal?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(Object.keys(PROPOSAL_TEMPLATES) as ProposalType[]).map((t) => (
                <label
                  key={t}
                  className={`cursor-pointer rounded-[12px] border p-4 transition-colors duration-150 ${type === t ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2"}`}
                >
                  <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" />
                  <span className="block font-medium">{PROPOSAL_TEMPLATES[t].label}</span>
                  <span className="mt-1 block text-sm text-muted">{PROPOSAL_TEMPLATES[t].description}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="topic" className="label">
              What is your research about?
            </label>
            <input
              id="topic"
              name="topic"
              className="input"
              required
              minLength={3}
              maxLength={300}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Sleep loss and memory in teenagers"
            />
          </div>
          <div>
            <label htmlFor="question" className="label">
              Your main research question <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="question"
              name="question"
              rows={2}
              maxLength={600}
              className="input resize-y py-3"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Does short sleep on school nights impair memory consolidation in 13 to 17 year olds?"
            />
            <p className="mt-1 text-sm text-muted">Leave it empty and Claude will suggest questions from your library.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="field" className="label">
                Field <span className="font-normal text-muted">(optional)</span>
              </label>
              <input id="field" name="field" className="input" maxLength={120} value={field} onChange={(e) => setField(e.target.value)} placeholder="Developmental psychology" />
            </div>
            <div>
              <label htmlFor="timeframe" className="label">
                Time to do the research
              </label>
              <select id="timeframe" name="timeframe" className="input" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                {TIMEFRAMES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <fieldset>
            <legend className="label">Length</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ["short", "Short", "About 200 words a section"],
                  ["full", "Full", "About 500 words a section"],
                ] as const
              ).map(([v, label, hint]) => (
                <label key={v} className={`cursor-pointer rounded-[10px] border px-4 py-2.5 ${length === v ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2"}`}>
                  <input type="radio" name="length" value={v} checked={length === v} onChange={() => setLength(v)} className="sr-only" />
                  <span className="font-medium">{label}</span> <span className="text-sm text-muted">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">Which papers should it build on?</legend>
            <div className="mt-2 grid gap-2">
              <label className="flex items-center gap-2.5">
                <input type="radio" name="sources" checked={sources === "library"} onChange={() => setSources("library")} />
                My whole library ({papers.length} {papers.length === 1 ? "paper" : "papers"})
              </label>
              <label className="flex items-center gap-2.5">
                <input type="radio" name="sources" checked={sources === "review"} onChange={() => setSources("review")} disabled={!reviews.length} />
                A literature review{!reviews.length && <span className="text-muted"> (you don&apos;t have one yet)</span>}
              </label>
              {sources === "review" && reviews.length > 0 && (
                <div className="ml-7">
                  <label htmlFor="review" className="sr-only">
                    Literature review
                  </label>
                  <select id="review" className="input" value={reviewId} onChange={(e) => setReviewId(e.target.value)}>
                    {reviews.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} ({r.included} included)
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-sm text-muted">Claude uses the review&apos;s synthesis to find the gap, and cites the studies it read.</p>
                </div>
              )}
              <label className="flex items-center gap-2.5">
                <input type="radio" name="sources" checked={sources === "papers"} onChange={() => setSources("papers")} disabled={!papers.length} />
                Papers I choose
              </label>
              {sources === "papers" && (
                <div className="ml-7">
                  <ScopePicker papers={papers} value={scope} onChange={setScope} />
                </div>
              )}
            </div>
          </fieldset>

          {errorBox}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
            <button className="btn-primary" disabled={busy !== null || topic.trim().length < 3}>
              {busy === "planning" ? "Claude is planning…" : "Plan my proposal"}
            </button>
            <p className="text-sm text-muted">{busy === "planning" ? "This takes about half a minute." : "Nothing is written until you approve the plan."}</p>
          </div>
        </form>
      ) : (
        plan && (
          <OutlineEditor
            title={title}
            onTitle={setTitle}
            plan={plan}
            onPlan={setPlan}
            busy={busy}
            error={errorBox}
            onBack={() => setStep("brief")}
            onReplan={() => void makePlan()}
            onCreate={() => void create()}
          />
        )
      )}
    </div>
  );
}

function OutlineEditor({
  title,
  onTitle,
  plan,
  onPlan,
  busy,
  error,
  onBack,
  onReplan,
  onCreate,
}: {
  title: string;
  onTitle: (t: string) => void;
  plan: ProposalPlan;
  onPlan: (p: ProposalPlan) => void;
  busy: "planning" | "creating" | null;
  error: React.ReactNode;
  onBack: () => void;
  onReplan: () => void;
  onCreate: () => void;
}) {
  const setSection = (i: number, patch: Partial<ProposalSection>) => onPlan({ ...plan, sections: plan.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, by: number) => {
    const next = [...plan.sections];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s);
    onPlan({ ...plan, sections: next });
  };
  const minutes = Math.max(1, Math.round((plan.sections.length * (plan.length === "full" ? 40 : 25)) / 60));

  return (
    <div className="mt-8 grid gap-8">
      <p className="text-muted">Here is Claude&apos;s plan. Change anything, then Claude writes each section, citing your papers.</p>
      <div>
        <label htmlFor="ptitle" className="label">
          Working title
        </label>
        <input id="ptitle" className="input text-lg" value={title} maxLength={200} onChange={(e) => onTitle(e.target.value)} />
      </div>

      <ListEditor label="Research questions" items={plan.researchQuestions} onChange={(researchQuestions) => onPlan({ ...plan, researchQuestions })} addLabel="Add a question" max={6} />
      <ListEditor label="Aims" items={plan.aims} onChange={(aims) => onPlan({ ...plan, aims })} addLabel="Add an aim" max={8} />

      <section aria-labelledby="sections-title">
        <h2 id="sections-title" className="label">
          Sections
        </h2>
        <ol className="mt-2 grid gap-3">
          {plan.sections.map((s, i) => (
            <li key={s.id} className="rounded-[12px] border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-sm text-muted tabular-nums">{i + 1}.</span>
                <label htmlFor={`h-${s.id}`} className="sr-only">
                  Section {i + 1} heading
                </label>
                <input id={`h-${s.id}`} className="input min-h-10 flex-1 font-medium" value={s.heading} maxLength={120} onChange={(e) => setSection(i, { heading: e.target.value })} />
                <button className="btn-ghost min-h-10 px-2.5 text-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${s.heading} up`}>
                  ↑
                </button>
                <button className="btn-ghost min-h-10 px-2.5 text-sm" disabled={i === plan.sections.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${s.heading} down`}>
                  ↓
                </button>
                <button
                  className="btn-ghost min-h-10 px-2.5 text-sm hover:text-danger"
                  disabled={plan.sections.length === 1}
                  onClick={() => onPlan({ ...plan, sections: plan.sections.filter((x) => x.id !== s.id) })}
                  aria-label={`Remove ${s.heading}`}
                >
                  Remove
                </button>
              </div>
              <label htmlFor={`g-${s.id}`} className="sr-only">
                What {s.heading} should cover
              </label>
              <textarea
                id={`g-${s.id}`}
                rows={2}
                maxLength={1000}
                className="input mt-2 resize-y py-2.5 text-sm"
                value={s.guidance}
                onChange={(e) => setSection(i, { guidance: e.target.value })}
                placeholder="What this section should cover"
              />
              <label className="mt-2 flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={s.cites} onChange={(e) => setSection(i, { cites: e.target.checked })} />
                Discusses existing research (cites your library)
              </label>
            </li>
          ))}
        </ol>
        <button
          className="btn-secondary mt-3"
          disabled={plan.sections.length >= 20}
          onClick={() => onPlan({ ...plan, sections: [...plan.sections, { id: crypto.randomUUID(), heading: "New section", guidance: "", cites: false }] })}
        >
          Add a section
        </button>
      </section>

      {error}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <button className="btn-primary" onClick={onCreate} disabled={busy !== null || !title.trim() || !plan.sections.some((s) => s.heading.trim())}>
          {busy === "creating" ? "Opening the editor…" : "Write the proposal"}
        </button>
        <button className="btn-secondary" onClick={onReplan} disabled={busy !== null}>
          {busy === "planning" ? "Planning…" : "Plan it again"}
        </button>
        <button className="btn-ghost" onClick={onBack} disabled={busy !== null}>
          Back
        </button>
        <p className="w-full text-sm text-muted">
          Claude writes the {plan.sections.length} sections one after another in the editor (about {minutes} {minutes === 1 ? "minute" : "minutes"}). You can stop at any point and redraft any section later.
        </p>
      </div>
    </div>
  );
}

function ListEditor({ label, items, onChange, addLabel, max }: { label: string; items: string[]; onChange: (v: string[]) => void; addLabel: string; max: number }) {
  const id = label.toLowerCase().replace(/\W+/g, "-");
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <ol className="mt-2 grid gap-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-2.5 w-6 text-sm text-muted tabular-nums">{i + 1}.</span>
            <label htmlFor={`${id}-${i}`} className="sr-only">
              {label} {i + 1}
            </label>
            <textarea
              id={`${id}-${i}`}
              rows={1}
              maxLength={400}
              className="input flex-1 resize-y py-2.5"
              value={item}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button className="btn-ghost min-h-10 px-2.5 text-sm hover:text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      <button className="btn-ghost mt-1 min-h-9 px-2 text-sm" disabled={items.length >= max} onClick={() => onChange([...items, ""])}>
        + {addLabel}
      </button>
    </fieldset>
  );
}
