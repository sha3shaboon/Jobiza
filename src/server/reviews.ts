import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ReviewCounts, ReviewCriteria } from "@/db/schema";
import { toSource } from "@/lib/chat/answer";
import { searchArxiv } from "@/lib/discovery/arxiv";
import { mergeRecords } from "@/lib/discovery/merge";
import { searchOpenAlex } from "@/lib/discovery/openalex";
import { searchPubmed } from "@/lib/discovery/pubmed";
import { searchSemanticScholar } from "@/lib/discovery/semantic-scholar";
import { SOURCE_LABELS, SourceUnavailableError, type DiscoveredRecord, type DiscoverySource } from "@/lib/discovery/types";
import { env } from "@/lib/env";
import { prismaFlow } from "@/lib/review/prisma";
import { ingestPaper } from "./ingest";
import { LibraryError, workspaceFor } from "./library";
import { enqueueIngest } from "./queue";
import { hybridSearch } from "./retrieval";
import {
  claudeFor,
  describeApiError,
  extractMatrix,
  planReview,
  ReviewAiError,
  screenRecords,
  synthesize,
  type ClaudeContext,
} from "./review-ai";

type Review = typeof schema.review.$inferSelect;
type ReviewRecord = typeof schema.reviewRecord.$inferSelect;

export const ALL_SOURCES: DiscoverySource[] = ["openalex", "semantic_scholar", "arxiv", "pubmed"];

/** Limits that keep a review's cost and time predictable. */
export const LIMITS = {
  resultsPerQueryPerSource: 25,
  aiScreeningMax: 200,
  screeningBatch: 20,
  agenticFullTexts: 10,
  screeningFullTexts: 40,
  synthesisPassages: 30,
  retrieveConcurrency: 3,
};

export type ReviewStep = "run" | "search" | "ai-screen" | "retrieve" | "extract" | "synthesize";

const RUNNING: Review["status"][] = ["searching", "screening", "retrieving", "extracting", "synthesizing"];

/* ───────────── Logging and status ───────────── */

async function log(reviewId: string, kind: string, message: string, data?: Record<string, unknown>) {
  await db().insert(schema.reviewEvent).values({ id: randomUUID(), reviewId, kind, message, data });
}

async function setStatus(reviewId: string, status: Review["status"], statusDetail: string | null = null) {
  await db().update(schema.review).set({ status, statusDetail }).where(eq(schema.review.id, reviewId));
}

/* ───────────── Ownership and reads ───────────── */

export async function ownedReview(userId: string, reviewId: string): Promise<Review> {
  const row = await db().query.review.findFirst({ where: and(eq(schema.review.id, reviewId), eq(schema.review.userId, userId)) });
  if (!row) throw new LibraryError("Review not found.", 404);
  return row;
}

export async function listReviews(userId: string) {
  const rows = await db().query.review.findMany({
    where: eq(schema.review.userId, userId),
    orderBy: [desc(schema.review.updatedAt)],
    limit: 100,
  });
  const counts = rows.length
    ? await db()
        .select({ reviewId: schema.reviewRecord.reviewId, screening: schema.reviewRecord.screening, n: sql<number>`count(*)::int` })
        .from(schema.reviewRecord)
        .where(inArray(schema.reviewRecord.reviewId, rows.map((r) => r.id)))
        .groupBy(schema.reviewRecord.reviewId, schema.reviewRecord.screening)
    : [];
  return rows.map((r) => {
    const mine = counts.filter((c) => c.reviewId === r.id);
    const of = (s: string) => mine.find((c) => c.screening === s)?.n ?? 0;
    return {
      id: r.id,
      title: r.title,
      question: r.question,
      mode: r.mode,
      status: r.status,
      statusDetail: r.statusDetail,
      records: of("pending") + of("included") + of("excluded"),
      included: of("included"),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

function toRecordDto(r: ReviewRecord) {
  return {
    id: r.id,
    title: r.title,
    authors: r.authors,
    year: r.year,
    venue: r.venue,
    abstract: r.abstract,
    doi: r.doi,
    url: r.url,
    pmid: r.pmid,
    arxivId: r.arxivId,
    citationCount: r.citationCount,
    sources: r.sources,
    openAccess: Boolean(r.openAccessPdfUrl),
    screening: r.screening,
    exclusionReason: r.exclusionReason,
    decidedBy: r.decidedBy,
    ai: r.ai,
    fullText: r.fullText,
    paperId: r.paperId,
    matrix: r.matrix,
  };
}
export type ReviewRecordDto = ReturnType<typeof toRecordDto>;

/**
 * Records opened for reading outside the retrieve step finish in the background;
 * bring their status up to date from the library paper.
 */
async function settleReading(records: ReviewRecord[]) {
  const waiting = records.filter((r) => r.fullText === "pending" && r.paperId);
  if (!waiting.length) return records;
  const papers = await db()
    .select({ id: schema.paper.id, status: schema.paper.status, metadataOnly: schema.paper.metadataOnly })
    .from(schema.paper)
    .where(inArray(schema.paper.id, waiting.map((r) => r.paperId!)));
  const byId = new Map(papers.map((p) => [p.id, p]));
  for (const r of waiting) {
    const p = byId.get(r.paperId!);
    if (!p || p.status === "queued" || p.status === "processing") continue;
    const fullText = p.status === "ready" ? (p.metadataOnly ? "abstract_only" : "retrieved") : "failed";
    await db().update(schema.reviewRecord).set({ fullText }).where(eq(schema.reviewRecord.id, r.id));
    r.fullText = fullText;
  }
  return records;
}

/** Open any found paper for reading: adds it to the library and fetches its text (open access when there is one). */
export async function readRecord(userId: string, reviewId: string, recordId: string) {
  const review = await ownedReview(userId, reviewId);
  const record = await db().query.reviewRecord.findFirst({
    where: and(eq(schema.reviewRecord.id, recordId), eq(schema.reviewRecord.reviewId, reviewId)),
  });
  if (!record) throw new LibraryError("Paper not found.", 404);
  if (record.paperId && record.fullText !== "failed") return toRecordDto(record);
  const paperId = await libraryPaperFor(review, record);
  if (!paperId) throw new LibraryError("Jobiza has no link to this paper's text. Try the publisher's site.", 422);
  const paper = await db().query.paper.findFirst({ where: eq(schema.paper.id, paperId) });
  // A new paper, or one that failed before, gets (re)processed; one already in the library is reused as is.
  if (!paper || paper.status === "queued" || paper.status === "failed") {
    await db().update(schema.paper).set({ status: "queued", statusDetail: null }).where(eq(schema.paper.id, paperId));
    await enqueueIngest(paperId);
  }
  const [row] = await db()
    .update(schema.reviewRecord)
    .set({ paperId, fullText: "pending" })
    .where(eq(schema.reviewRecord.id, record.id))
    .returning();
  await log(review.id, "read", `Opened “${record.title}” for reading.`);
  const [settled] = await settleReading([row]);
  return toRecordDto(settled);
}

export async function getReviewDetail(userId: string, reviewId: string) {
  const review = await ownedReview(userId, reviewId);
  const [records, events] = await Promise.all([
    db().query.reviewRecord.findMany({
      where: eq(schema.reviewRecord.reviewId, reviewId),
      orderBy: [asc(schema.reviewRecord.rank)],
    }),
    db().query.reviewEvent.findMany({
      where: eq(schema.reviewEvent.reviewId, reviewId),
      orderBy: [desc(schema.reviewEvent.createdAt)],
      limit: 200,
    }),
  ]);
  return {
    review: {
      id: review.id,
      title: review.title,
      question: review.question,
      mode: review.mode,
      status: review.status,
      statusDetail: review.statusDetail,
      criteria: review.criteria,
      queries: review.queries,
      sources: review.sources,
      matrixColumns: review.matrixColumns,
      synthesis: review.synthesis,
      synthesisCitations: review.synthesisCitations,
      createdAt: review.createdAt.toISOString(),
    },
    records: (await settleReading(records)).map(toRecordDto),
    prisma: prismaFlow(review.counts, records),
    unavailableSources: review.counts?.unavailable ?? [],
    events: events.map((e) => ({ id: e.id, kind: e.kind, message: e.message, at: e.createdAt.toISOString() })),
  };
}
export type ReviewDetail = Awaited<ReturnType<typeof getReviewDetail>>;

/* ───────────── Create and edit ───────────── */

export async function createReview(userId: string, input: { question: string; mode: "agentic" | "screening" }) {
  const ws = await workspaceFor(userId);
  const id = randomUUID();
  const title = input.question.replace(/\s+/g, " ").slice(0, 100);
  const [row] = await db()
    .insert(schema.review)
    .values({ id, workspaceId: ws.id, userId, title, question: input.question, mode: input.mode })
    .returning();
  await log(id, "created", input.mode === "agentic" ? "Review created. Jobiza will research it on its own." : "Review created for screening.");
  return row;
}

export type ReviewPatch = Partial<{
  title: string;
  question: string;
  criteria: ReviewCriteria;
  queries: string[];
  sources: DiscoverySource[];
  matrixColumns: string[];
}>;

export async function updateReview(userId: string, reviewId: string, patch: ReviewPatch) {
  const review = await ownedReview(userId, reviewId);
  if (RUNNING.includes(review.status)) throw new LibraryError("Wait for the current step to finish before editing.", 409);
  await db().update(schema.review).set(patch).where(eq(schema.review.id, reviewId));
}

export async function deleteReview(userId: string, reviewId: string) {
  await ownedReview(userId, reviewId);
  await db().delete(schema.review).where(eq(schema.review.id, reviewId));
}

/** Claude suggests queries, criteria and table columns (screening mode's "Suggest" button). */
export async function suggestPlan(userId: string, reviewId: string) {
  const review = await ownedReview(userId, reviewId);
  const plan = await planReview(await claudeFor(userId), review.question, review.criteria);
  await db()
    .update(schema.review)
    .set({
      title: review.title === review.question.slice(0, 100) ? plan.title : review.title,
      queries: plan.queries,
      criteria: { ...review.criteria, include: plan.include, exclude: plan.exclude },
      matrixColumns: plan.matrixColumns,
    })
    .where(eq(schema.review.id, reviewId));
  await log(reviewId, "plan", `Claude suggested ${plan.queries.length} search queries, criteria and ${plan.matrixColumns.length} table columns.`);
}

/** A researcher's include/exclude decision during screening. */
export async function decideRecord(userId: string, reviewId: string, recordId: string, decision: "included" | "excluded" | "pending", reason?: string) {
  await ownedReview(userId, reviewId);
  const [row] = await db()
    .update(schema.reviewRecord)
    .set({
      screening: decision,
      exclusionReason: decision === "excluded" ? reason?.slice(0, 200) || "Excluded by reviewer" : null,
      decidedBy: decision === "pending" ? null : "user",
    })
    .where(and(eq(schema.reviewRecord.id, recordId), eq(schema.reviewRecord.reviewId, reviewId)))
    .returning();
  if (!row) throw new LibraryError("Record not found.", 404);
  return toRecordDto(row);
}

/** Accept Claude's suggestions for all records still pending. */
export async function acceptAiSuggestions(userId: string, reviewId: string) {
  await ownedReview(userId, reviewId);
  const pending = await db().query.reviewRecord.findMany({
    where: and(eq(schema.reviewRecord.reviewId, reviewId), eq(schema.reviewRecord.screening, "pending"), isNotNull(schema.reviewRecord.ai)),
  });
  for (const r of pending) {
    await db()
      .update(schema.reviewRecord)
      .set({
        screening: r.ai!.decision === "include" ? "included" : "excluded",
        exclusionReason: r.ai!.decision === "exclude" ? r.ai!.reason : null,
        decidedBy: "ai",
      })
      .where(eq(schema.reviewRecord.id, r.id));
  }
  await log(reviewId, "screening", `Accepted Claude's suggestions for ${pending.length} records.`);
  return pending.length;
}

/* ───────────── Steps (run in the worker) ───────────── */

function searchers(): Record<DiscoverySource, (q: { query: string; limit: number; yearFrom?: number; yearTo?: number }) => Promise<DiscoveredRecord[]>> {
  const e = process.env;
  return {
    openalex: (o) => searchOpenAlex(o, { apiKey: e.OPENALEX_API_KEY, mailto: env().CONTACT_EMAIL }),
    semantic_scholar: (o) => searchSemanticScholar(o, { apiKey: e.SEMANTIC_SCHOLAR_API_KEY }),
    arxiv: (o) => searchArxiv(o),
    pubmed: (o) => searchPubmed(o, { apiKey: e.NCBI_API_KEY }),
  };
}

async function stepSearch(review: Review) {
  if (!review.queries.length) throw new ReviewAiError("Add at least one search query.");
  const sources = (review.sources.length ? review.sources : ALL_SOURCES) as DiscoverySource[];
  await setStatus(review.id, "searching", `Searching ${sources.map((s) => SOURCE_LABELS[s]).join(", ")}`);
  const run = searchers();
  const lists: { records: DiscoveredRecord[] }[] = [];
  const identified: Record<string, number> = {};
  const unavailable: ReviewCounts["unavailable"] = [];

  for (const source of sources) {
    for (const query of review.queries) {
      if (unavailable.some((u) => u.source === source)) break;
      try {
        const records = await run[source]({
          query,
          limit: LIMITS.resultsPerQueryPerSource,
          yearFrom: review.criteria.yearFrom,
          yearTo: review.criteria.yearTo,
        });
        lists.push({ records });
        identified[source] = (identified[source] ?? 0) + records.length;
      } catch (err) {
        const message = err instanceof SourceUnavailableError ? err.message : `${SOURCE_LABELS[source]} search failed.`;
        unavailable.push({ source, reason: message });
        await log(review.id, "source", `${message} Continuing with the other sources.`);
      }
    }
    if (identified[source] !== undefined) await log(review.id, "search", `${SOURCE_LABELS[source]}: ${identified[source]} results.`);
  }

  const { records, duplicates } = mergeRecords(lists);
  if (!records.length) {
    throw new ReviewAiError(
      unavailable.length === sources.length
        ? "None of the sources could be searched right now. Try again later, or add API keys for OpenAlex or Semantic Scholar."
        : "The searches found nothing. Try broader queries.",
    );
  }
  // Rank: best position in any list, then how many sources found it.
  records.sort((a, b) => a.bestRank - b.bestRank || b.sources.length - a.sources.length);

  await db().transaction(async (tx) => {
    // A re-run keeps decided records and replaces undecided ones.
    await tx.delete(schema.reviewRecord).where(and(eq(schema.reviewRecord.reviewId, review.id), eq(schema.reviewRecord.screening, "pending")));
    const existing = new Set(
      (await tx.select({ key: schema.reviewRecord.key }).from(schema.reviewRecord).where(eq(schema.reviewRecord.reviewId, review.id))).map((r) => r.key),
    );
    const fresh = records.filter((r) => !existing.has(r.key));
    for (let i = 0; i < fresh.length; i += 200) {
      await tx.insert(schema.reviewRecord).values(
        fresh.slice(i, i + 200).map((r, j) => ({
          id: randomUUID(),
          reviewId: review.id,
          key: r.key,
          title: r.title.slice(0, 1000),
          authors: r.authors.slice(0, 50),
          year: r.year,
          venue: r.venue?.slice(0, 300),
          abstract: r.abstract?.slice(0, 8000),
          doi: r.doi,
          pmid: r.pmid,
          arxivId: r.arxivId,
          url: r.url,
          openAccessPdfUrl: r.openAccessPdfUrl,
          citationCount: r.citationCount,
          sources: r.sources,
          rank: i + j,
        })),
      );
    }
    await tx.update(schema.review).set({ counts: { identified, duplicates, unavailable } }).where(eq(schema.review.id, review.id));
  });
  await log(review.id, "dedupe", `${records.length} unique records after removing ${duplicates} duplicates.`);
}

async function stepAiScreen(review: Review, ctx: ClaudeContext, { apply }: { apply: boolean }) {
  const pending = await db().query.reviewRecord.findMany({
    where: and(eq(schema.reviewRecord.reviewId, review.id), eq(schema.reviewRecord.screening, "pending")),
    orderBy: [asc(schema.reviewRecord.rank)],
    limit: LIMITS.aiScreeningMax,
  });
  if (!pending.length) return;
  let done = 0;
  for (let i = 0; i < pending.length; i += LIMITS.screeningBatch) {
    const batch = pending.slice(i, i + LIMITS.screeningBatch);
    await setStatus(review.id, "screening", `Screening titles and abstracts (${done} of ${pending.length})`);
    const ids = new Map(batch.map((r, j) => [`R${j + 1}`, r]));
    const ask = (entries: [string, ReviewRecord][]) =>
      screenRecords(ctx, review.question, review.criteria, entries.map(([id, r]) => ({ id, title: r.title, year: r.year, abstract: r.abstract })));
    const decisions = await ask([...ids]);
    // Ask once more about any record the response skipped.
    const missed = [...ids].filter(([id]) => !decisions.has(id));
    if (missed.length) for (const [id, d] of await ask(missed)) if (ids.has(id)) decisions.set(id, d);
    for (const [id, r] of ids) {
      const d = decisions.get(id);
      if (!d) continue;
      await db()
        .update(schema.reviewRecord)
        .set(
          apply
            ? { ai: d, screening: d.decision === "include" ? "included" : "excluded", exclusionReason: d.decision === "exclude" ? d.reason : null, decidedBy: "ai" }
            : { ai: d },
        )
        .where(eq(schema.reviewRecord.id, r.id));
    }
    done += batch.length;
  }
  const verb = apply ? "screened" : "suggested decisions for";
  await log(review.id, "screening", `Claude ${verb} ${done} records by title and abstract.`);
}

/** Add included records to the library and read them (full text when open access, otherwise the abstract). */
async function stepRetrieve(review: Review, cap: number) {
  const included = await db().query.reviewRecord.findMany({
    where: and(eq(schema.reviewRecord.reviewId, review.id), eq(schema.reviewRecord.screening, "included")),
    orderBy: [desc(sql`coalesce((${schema.reviewRecord.ai}->>'relevance')::int, 50)`), asc(schema.reviewRecord.rank)],
  });
  const todo = included.filter((r) => r.fullText === "not_requested" || r.fullText === "failed").slice(0, cap);
  if (!todo.length) return;
  // Fetch and index a few studies at a time: most of the wait is network.
  let started = 0;
  let finished = 0;
  const one = async (r: ReviewRecord) => {
    const paperId = await libraryPaperFor(review, r);
    if (!paperId) {
      await db().update(schema.reviewRecord).set({ fullText: "failed" }).where(eq(schema.reviewRecord.id, r.id));
      return;
    }
    await db().update(schema.reviewRecord).set({ fullText: "pending", paperId }).where(eq(schema.reviewRecord.id, r.id));
    try {
      await ingestPaper(paperId);
    } catch {
      // ingestPaper already recorded the failure on the paper
    }
    const paper = await db().query.paper.findFirst({ where: eq(schema.paper.id, paperId) });
    const fullText = paper?.status === "ready" ? (paper.metadataOnly ? "abstract_only" : "retrieved") : "failed";
    await db().update(schema.reviewRecord).set({ fullText }).where(eq(schema.reviewRecord.id, r.id));
  };
  const workers = Array.from({ length: Math.min(LIMITS.retrieveConcurrency, todo.length) }, async () => {
    while (started < todo.length) {
      const r = todo[started++];
      await one(r);
      finished++;
      await setStatus(review.id, "retrieving", `Reading included studies (${finished} of ${todo.length})`);
    }
  });
  await setStatus(review.id, "retrieving", `Reading included studies (0 of ${todo.length})`);
  await Promise.all(workers);
  const after = await db().query.reviewRecord.findMany({
    where: and(eq(schema.reviewRecord.reviewId, review.id), inArray(schema.reviewRecord.id, todo.map((t) => t.id))),
  });
  const full = after.filter((r) => r.fullText === "retrieved").length;
  const abs = after.filter((r) => r.fullText === "abstract_only").length;
  await log(review.id, "retrieve", `Added ${todo.length} studies to your library: ${full} full text, ${abs} abstract only, ${todo.length - full - abs} couldn't be read.`);
}

/** Reuse a paper already in the library, or create one pre-filled from the record. */
async function libraryPaperFor(review: Review, r: ReviewRecord): Promise<string | null> {
  if (r.paperId) return r.paperId;
  if (r.doi) {
    const existing = await db().query.paper.findFirst({
      where: and(eq(schema.paper.workspaceId, review.workspaceId), eq(schema.paper.doi, r.doi)),
    });
    if (existing) return existing.id;
  }
  const id = randomUUID();
  const base = {
    id,
    workspaceId: review.workspaceId,
    addedBy: review.userId,
    title: r.title,
    authors: r.authors.map((name) => ({ name })),
    year: r.year,
    venue: r.venue,
    doi: r.doi,
    abstract: r.abstract,
  };
  // An open-access PDF is fetched directly; otherwise the DOI route falls back to the abstract.
  if (r.openAccessPdfUrl) await db().insert(schema.paper).values({ ...base, source: "url", url: r.openAccessPdfUrl });
  else if (r.doi) await db().insert(schema.paper).values({ ...base, source: "doi" });
  else if (r.url) await db().insert(schema.paper).values({ ...base, source: "url", url: r.url });
  else return null;
  return id;
}

async function readablePapers(reviewId: string) {
  return db().query.reviewRecord.findMany({
    where: and(
      eq(schema.reviewRecord.reviewId, reviewId),
      eq(schema.reviewRecord.screening, "included"),
      inArray(schema.reviewRecord.fullText, ["retrieved", "abstract_only"]),
      isNotNull(schema.reviewRecord.paperId),
    ),
    orderBy: [asc(schema.reviewRecord.rank)],
  });
}

async function stepExtract(review: Review, ctx: ClaudeContext) {
  const columns = review.matrixColumns.length ? review.matrixColumns : ["Study design", "Sample", "Key finding", "Limitations"];
  if (!review.matrixColumns.length) await db().update(schema.review).set({ matrixColumns: columns }).where(eq(schema.review.id, review.id));
  const records = await readablePapers(review.id);
  let n = 0;
  for (const r of records) {
    n++;
    await setStatus(review.id, "extracting", `Filling the comparison table (${n} of ${records.length})`);
    const chunks = await hybridSearch(review.workspaceId, `${review.question}\n${columns.join(", ")}`, {
      paperIds: [r.paperId!],
      limit: 8,
    });
    if (!chunks.length) continue;
    const cells = await extractMatrix(ctx, review.question, columns, {
      title: r.title,
      passages: chunks.map((c) => ({ page: c.pageNumber, text: c.text })),
    });
    await db().update(schema.reviewRecord).set({ matrix: cells }).where(eq(schema.reviewRecord.id, r.id));
  }
  await log(review.id, "extract", `Filled ${columns.length} columns for ${records.length} studies.`);
}

async function stepSynthesize(review: Review, ctx: ClaudeContext) {
  const records = await readablePapers(review.id);
  if (!records.length) throw new ReviewAiError("No included studies could be read, so there's nothing to synthesise yet.");
  await setStatus(review.id, "synthesizing", `Writing the synthesis from ${records.length} studies`);
  const chunks = await hybridSearch(review.workspaceId, review.question, {
    paperIds: records.map((r) => r.paperId!),
    limit: LIMITS.synthesisPassages,
    perPaperLimit: 4,
  });
  const answer = await synthesize(ctx, review.question, chunks.map(toSource), records.length);
  await db()
    .update(schema.review)
    .set({ synthesis: answer.text, synthesisCitations: answer.citations })
    .where(eq(schema.review.id, review.id));
  await log(review.id, "synthesis", `Wrote the synthesis with ${answer.citations.length} citations.`);
}

/** Entry point for the worker. */
export async function runReviewStep(reviewId: string, step: ReviewStep) {
  const load = async () => (await db().query.review.findFirst({ where: eq(schema.review.id, reviewId) }))!;
  let review = await load();
  if (!review) return;
  try {
    const needsClaude = step !== "search";
    const ctx = needsClaude ? await claudeFor(review.userId) : null;

    if (step === "run") {
      if (!review.queries.length) {
        await setStatus(reviewId, "searching", "Planning the search");
        const plan = await planReview(ctx!, review.question, review.criteria);
        await db()
          .update(schema.review)
          .set({ title: plan.title, queries: plan.queries, criteria: { ...review.criteria, include: plan.include, exclude: plan.exclude }, matrixColumns: plan.matrixColumns })
          .where(eq(schema.review.id, reviewId));
        await log(reviewId, "plan", `Planned ${plan.queries.length} queries: ${plan.queries.map((q) => `“${q}”`).join(", ")}.`);
        review = await load();
      }
      await stepSearch(review);
      await stepAiScreen(await load(), ctx!, { apply: true });
      await stepRetrieve(await load(), LIMITS.agenticFullTexts);
      await stepExtract(await load(), ctx!);
      await stepSynthesize(await load(), ctx!);
    } else if (step === "search") await stepSearch(review);
    else if (step === "ai-screen") await stepAiScreen(review, ctx!, { apply: false });
    else if (step === "retrieve") await stepRetrieve(review, LIMITS.screeningFullTexts);
    else if (step === "extract") await stepExtract(review, ctx!);
    else if (step === "synthesize") await stepSynthesize(review, ctx!);

    const hasSynthesis = Boolean((await load()).synthesis);
    const finalStatus: Review["status"] = step === "run" || step === "synthesize" || hasSynthesis ? "ready" : "draft";
    await setStatus(reviewId, finalStatus);
    if (step === "run" || step === "synthesize") await log(reviewId, "done", "Review ready.");
  } catch (err) {
    const message = describeApiError(err);
    if (!(err instanceof ReviewAiError)) console.error(`[review] ${reviewId} ${step} failed:`, err);
    await setStatus(reviewId, "failed", message);
    await log(reviewId, "error", message);
  }
}

/** Queue a step, refusing while another is running. */
export async function startStep(userId: string, reviewId: string, step: ReviewStep, enqueue: (reviewId: string, step: ReviewStep) => Promise<void>) {
  const review = await ownedReview(userId, reviewId);
  if (RUNNING.includes(review.status)) throw new LibraryError("A step is already running for this review.", 409);
  const label: Record<ReviewStep, string> = {
    run: "Starting the review",
    search: "Starting the search",
    "ai-screen": "Asking Claude to screen",
    retrieve: "Getting the included studies",
    extract: "Filling the comparison table",
    synthesize: "Writing the synthesis",
  };
  await setStatus(reviewId, step === "search" || step === "run" ? "searching" : step === "ai-screen" ? "screening" : step === "retrieve" ? "retrieving" : step === "extract" ? "extracting" : "synthesizing", label[step]);
  await enqueue(reviewId, step);
}

export async function exportRecords(userId: string, reviewId: string) {
  await ownedReview(userId, reviewId);
  const records = await db().query.reviewRecord.findMany({
    where: eq(schema.reviewRecord.reviewId, reviewId),
    orderBy: [asc(schema.reviewRecord.rank)],
  });
  return records.map((r) => ({
    title: r.title,
    authors: r.authors.join("; "),
    year: r.year,
    venue: r.venue,
    doi: r.doi,
    pmid: r.pmid,
    url: r.url,
    sources: r.sources.join("; "),
    decision: r.screening,
    decided_by: r.decidedBy,
    exclusion_reason: r.exclusionReason,
    ai_suggestion: r.ai?.decision,
    ai_reason: r.ai?.reason,
    ai_relevance: r.ai?.relevance,
    full_text: r.fullText,
  }));
}
