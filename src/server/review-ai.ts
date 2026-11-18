import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { AiScreening, MatrixCell, ReviewCriteria } from "@/db/schema";
import { buildAnswer, searchResultBlocks, type Source } from "@/lib/chat/answer";
import { getApiKey, getSettings } from "./settings";

export class ReviewAiError extends Error {}

export type ClaudeContext = { client: Anthropic; model: string };

/** The review owner's own key and model. */
export async function claudeFor(userId: string): Promise<ClaudeContext> {
  const [apiKey, settings] = await Promise.all([getApiKey(userId), getSettings(userId)]);
  if (!apiKey || !settings.model) throw new ReviewAiError("Add your Anthropic API key and choose a model in Settings first.");
  return { client: new Anthropic({ apiKey, maxRetries: 3 }), model: settings.model };
}

export function describeApiError(err: unknown): string {
  if (err instanceof ReviewAiError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic rejected your API key. Update it in Settings.";
  if (err instanceof Anthropic.RateLimitError) return "Anthropic's rate limit was reached for your key. Try again in a minute.";
  if (err instanceof Anthropic.NotFoundError || err instanceof Anthropic.PermissionDeniedError) {
    return "Your key can't use the selected model. Pick another model in Settings.";
  }
  if (err instanceof Anthropic.BadRequestError && /credit|billing/i.test(err.message)) return "Your Anthropic account is out of credit.";
  if (err instanceof Anthropic.APIError) return "Claude couldn't complete this step. Try again.";
  return "Something went wrong. Try again.";
}

async function structured<T extends z.ZodType>(
  { client, model }: ClaudeContext,
  schema: T,
  system: string,
  user: Anthropic.MessageParam["content"],
  maxTokens = 8000,
): Promise<z.infer<T>> {
  const res = await client.messages.parse({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(schema) },
  });
  if (res.stop_reason === "refusal") throw new ReviewAiError("Claude declined this step of the review.");
  if (!res.parsed_output) throw new ReviewAiError("Claude's response couldn't be read. Try again.");
  return res.parsed_output;
}

/* ───────────── 1. Plan ───────────── */

const PlanSchema = z.object({
  title: z.string().describe("Short title for the review, under 80 characters"),
  queries: z.array(z.string()).describe("3 to 6 keyword search queries for academic databases"),
  include: z.array(z.string()).describe("2 to 5 inclusion criteria"),
  exclude: z.array(z.string()).describe("2 to 5 exclusion criteria"),
  matrixColumns: z.array(z.string()).describe("4 to 6 short column names for comparing included studies"),
});
export type ReviewPlan = z.infer<typeof PlanSchema>;

export async function planReview(ctx: ClaudeContext, question: string, criteria?: Partial<ReviewCriteria>): Promise<ReviewPlan> {
  const system = `You plan systematic literature searches for students and researchers.
Queries are for keyword search engines (OpenAlex, Semantic Scholar, arXiv, PubMed): 3 to 8 words each, no boolean operators or quotes, covering synonyms and the key facets of the question. Don't repeat the same words across every query.
Criteria are concrete and checkable from a title and abstract (population, intervention or exposure, outcome, study design, language). Put date limits in the criteria only if the question implies them.
Matrix columns compare included studies, for example "Study design", "Sample", "Key finding", "Limitations"; tailor them to the question.`;
  const extra = criteria?.include?.length || criteria?.exclude?.length ? `\n\nThe researcher already set these criteria; keep them and add only what's missing:\n${JSON.stringify(criteria)}` : "";
  const plan = await structured(ctx, PlanSchema, system, `Research question: ${question}${extra}`, 4000);
  return {
    title: plan.title.slice(0, 120),
    queries: plan.queries.map((q) => q.trim()).filter(Boolean).slice(0, 6),
    include: plan.include.slice(0, 6),
    exclude: plan.exclude.slice(0, 6),
    matrixColumns: plan.matrixColumns.map((c) => c.trim()).filter(Boolean).slice(0, 6),
  };
}

/* ───────────── 2. Screen titles and abstracts ───────────── */

const ScreenSchema = z.object({
  decisions: z.array(
    z.object({
      id: z.string().describe("The record id, e.g. R3"),
      decision: z.enum(["include", "exclude"]),
      reason: z.string().describe("One short sentence; for exclusions, name the criterion that isn't met"),
      relevance: z.number().describe("0 to 100: how directly the record answers the question"),
    }),
  ),
});

export type ScreeningInput = { id: string; title: string; year?: number | null; abstract?: string | null };

export async function screenRecords(
  ctx: ClaudeContext,
  question: string,
  criteria: ReviewCriteria,
  records: ScreeningInput[],
): Promise<Map<string, AiScreening>> {
  const system = `You screen search results for a literature review by title and abstract, like a careful second reviewer.
Include a record only if it plausibly meets every inclusion criterion and none of the exclusion criteria. If the abstract is missing, judge from the title and lean towards include when it's clearly on topic.
Return one decision for every record id you are given.`;
  const list = records
    .map((r) => `[${r.id}] ${r.title}${r.year ? ` (${r.year})` : ""}\n${(r.abstract ?? "No abstract.").slice(0, 1800)}`)
    .join("\n\n");
  const user = `Research question: ${question}

Inclusion criteria:
${criteria.include.map((c) => `- ${c}`).join("\n") || "- (none given)"}
Exclusion criteria:
${criteria.exclude.map((c) => `- ${c}`).join("\n") || "- (none given)"}${criteria.yearFrom || criteria.yearTo ? `\nPublished between ${criteria.yearFrom ?? "any"} and ${criteria.yearTo ?? "now"}.` : ""}

Records:
${list}`;
  const out = await structured(ctx, ScreenSchema, system, user, 8000);
  const result = new Map<string, AiScreening>();
  for (const d of out.decisions) {
    result.set(d.id, { decision: d.decision, reason: d.reason.slice(0, 300), relevance: Math.max(0, Math.min(100, Math.round(d.relevance))) });
  }
  return result;
}

/* ───────────── 3. Extract comparison-table values ───────────── */

const ExtractSchema = z.object({
  cells: z.array(
    z.object({
      column: z.string(),
      value: z.string().describe("Under 30 words, taken from the passages; 'Not reported' if absent"),
      page: z.number().describe("Page or section number of the passage the value came from; 0 if not reported"),
    }),
  ),
});

export async function extractMatrix(
  ctx: ClaudeContext,
  question: string,
  columns: string[],
  paper: { title: string; passages: { page: number; text: string }[] },
): Promise<Record<string, MatrixCell>> {
  const system = `You extract data from one study for a literature review comparison table.
Use only the passages given. Be specific (numbers, sample sizes, designs) and brief. Write "Not reported" when the passages don't say.`;
  const passages = paper.passages.map((p) => `[page ${p.page}] ${p.text}`).join("\n\n");
  const user = `Review question: ${question}
Study: ${paper.title}
Columns: ${columns.join(" | ")}

Passages:
${passages}`;
  const out = await structured(ctx, ExtractSchema, system, user, 4000);
  const cells: Record<string, MatrixCell> = {};
  for (const column of columns) {
    const c = out.cells.find((x) => x.column.trim().toLowerCase() === column.toLowerCase());
    cells[column] = c ? { value: c.value.slice(0, 400), page: c.page > 0 ? c.page : undefined } : { value: "Not reported" };
  }
  return cells;
}

/* ───────────── 4. Cited synthesis ───────────── */

export async function synthesize(ctx: ClaudeContext, question: string, sources: Source[], studyCount: number) {
  const system = `You write the synthesis section of a literature review from the passages provided as search results, citing them.
Structure: an opening paragraph answering the question directly; then one short paragraph per theme (what the studies found, where they agree, where and why they differ); then a paragraph on limitations of the evidence and gaps for future research.
Rules: use only the passages; cite every factual claim; refer to studies by author and year in prose; note sample sizes and designs when they matter; don't overstate certainty. Write plain text without Markdown headings, bold or tables, for students and researchers.`;
  const res = await ctx.client.messages
    .stream({
      model: ctx.model,
      max_tokens: 12000,
      system,
      messages: [
        {
          role: "user",
          content: [
            ...searchResultBlocks(sources),
            { type: "text", text: `Review question: ${question}\nThe passages come from ${studyCount} included studies. Write the synthesis.` },
          ],
        },
      ],
    })
    .finalMessage();
  if (res.stop_reason === "refusal") throw new ReviewAiError("Claude declined to write the synthesis.");
  return buildAnswer(res.content, sources);
}
