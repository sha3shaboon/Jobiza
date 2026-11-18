import "server-only";
import { randomUUID } from "node:crypto";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ClaimCheck } from "@/db/schema";
import { buildAnswer, searchResultBlocks, toSource } from "@/lib/chat/answer";
import { findHighlightRange } from "@/lib/chat/highlight";
import { citedPaperIds, sentencesWithCitations, type DocNode } from "@/lib/writing/doc";
import { answerToNodes } from "@/lib/writing/draft";
import { renderCitations } from "./citations";
import { LibraryError, workspaceFor } from "./library";
import { hybridSearch, type RetrievedChunk } from "./retrieval";
import { claudeFor, ReviewAiError } from "./review-ai";
import { getSettings } from "./settings";

type Doc = typeof schema.document.$inferSelect;

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };
const MAX_CHECKED_SENTENCES = 40;

/* ───────────── CRUD ───────────── */

export async function listDocuments(userId: string) {
  const rows = await db().query.document.findMany({
    where: eq(schema.document.userId, userId),
    orderBy: [desc(schema.document.updatedAt)],
    columns: { id: true, title: true, updatedAt: true, citationStyle: true },
    limit: 200,
  });
  return rows.map((r) => ({ id: r.id, title: r.title, citationStyle: r.citationStyle, updatedAt: r.updatedAt.toISOString() }));
}

export async function ownedDocument(userId: string, id: string): Promise<Doc> {
  const row = await db().query.document.findFirst({ where: and(eq(schema.document.id, id), eq(schema.document.userId, userId)) });
  if (!row) throw new LibraryError("Document not found.", 404);
  return row;
}

export async function createDocument(userId: string, title?: string) {
  const ws = await workspaceFor(userId);
  const style = (await getSettings(userId)).citationStyle;
  const [row] = await db()
    .insert(schema.document)
    .values({ id: randomUUID(), workspaceId: ws.id, userId, title: title?.trim() || "Untitled document", content: EMPTY_DOC, citationStyle: style })
    .returning();
  return row;
}

export async function updateDocument(userId: string, id: string, patch: { title?: string; content?: DocNode; citationStyle?: string }) {
  await ownedDocument(userId, id);
  const [row] = await db()
    .update(schema.document)
    .set(patch as Partial<typeof schema.document.$inferInsert>)
    .where(eq(schema.document.id, id))
    .returning({ updatedAt: schema.document.updatedAt });
  return row.updatedAt.toISOString();
}

export async function deleteDocument(userId: string, id: string) {
  await ownedDocument(userId, id);
  await db().delete(schema.document).where(eq(schema.document.id, id));
}

/* ───────────── Citations ───────────── */

/** Papers the user can cite: everything in their library that isn't still failing. */
export async function citablePapers(userId: string) {
  const ws = await workspaceFor(userId);
  return db().query.paper.findMany({
    where: eq(schema.paper.workspaceId, ws.id),
    orderBy: [desc(schema.paper.createdAt)],
  });
}

async function papersById(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const ws = await workspaceFor(userId);
  return db().query.paper.findMany({ where: and(eq(schema.paper.workspaceId, ws.id), inArray(schema.paper.id, ids)) });
}

export async function renderForDocument(userId: string, content: DocNode, style: string) {
  return renderCitations(content, style, await papersById(userId, citedPaperIds(content)));
}

/* ───────────── Draft with Claude ───────────── */

const DRAFT_SYSTEM = `You help students and researchers draft academic prose from their own library. The passages provided as search results are the only evidence you may use.

Write what the user asks for, in a clear academic register: precise, hedged where the evidence is limited, no filler. Cite every factual claim from the passages. Don't invent findings, numbers or sources. If the passages don't support what's asked, write what they do support and say what's missing in one sentence.
Write plain prose paragraphs separated by blank lines, without Markdown headings, bold or tables. Don't add a title or a references list: the editor adds citations and the bibliography.`;

export async function draftWithClaude(userId: string, docId: string, instruction: string, scopePaperIds: string[] = []) {
  const doc = await ownedDocument(userId, docId);
  const ctx = await claudeFor(userId);
  const chunks = await hybridSearch(doc.workspaceId, instruction, { paperIds: scopePaperIds, limit: 16 });
  if (!chunks.length) throw new ReviewAiError("Your library has no processed papers that match. Add or select papers first.");
  const sources = chunks.map(toSource);
  const res = await ctx.client.messages
    .stream({
      model: ctx.model,
      max_tokens: 8000,
      system: DRAFT_SYSTEM,
      messages: [{ role: "user", content: [...searchResultBlocks(sources), { type: "text", text: `Document title: ${doc.title}\n\nWrite: ${instruction}` }] }],
    })
    .finalMessage();
  if (res.stop_reason === "refusal") throw new ReviewAiError("Claude declined to write this.");
  const answer = buildAnswer(res.content, sources);
  return { nodes: answerToNodes(answer.text, answer.citations, randomUUID), citations: answer.citations.length };
}

/* ───────────── Claim checker ───────────── */

const CheckSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(["supported", "partly_supported", "not_supported", "needs_citation", "no_citation_needed", "cannot_verify"]),
      explanation: z.string().describe("One or two sentences for the writer"),
      passage: z.string().describe("Id of the passage that best supports or contradicts the sentence, e.g. P3, or empty"),
      quote: z.string().describe("Exact words copied from that passage (under 40 words), or empty"),
    }),
  ),
});

const CHECK_SYSTEM = `You check a draft's sentences against the sources, like a careful editor.
For a sentence WITH citations, compare it only with the passages from the papers it cites:
- supported: the passages state it (allowing paraphrase).
- partly_supported: some of it is stated, but a detail (number, scope, population, certainty) goes beyond the passages.
- not_supported: the passages don't say it, or say something different.
- cannot_verify: the passages shown don't cover the topic at all (the relevant part of the paper may not be in them).
For a sentence WITHOUT citations:
- no_citation_needed: opinions, transitions, definitions everyone agrees on, or the writer's own argument.
- needs_citation: a factual or empirical claim. If one of the candidate passages supports it, name that passage.
Always copy the quote exactly from the passage text, without changing words.`;

type CheckPassage = { key: string; chunk: RetrievedChunk };

export async function checkClaims(userId: string, docId: string): Promise<ClaimCheck[]> {
  const doc = await ownedDocument(userId, docId);
  const ctx = await claudeFor(userId);
  const sentences = sentencesWithCitations(doc.content as DocNode)
    .filter((s) => s.text.split(/\s+/).length >= 5)
    .slice(0, MAX_CHECKED_SENTENCES);
  if (!sentences.length) throw new ReviewAiError("Write a few full sentences first.");

  // Gather passages: the cited papers for cited sentences, the whole library otherwise.
  const prepared = await Promise.all(
    sentences.map(async (s) => {
      const cited = [...new Set(s.citations.map((c) => c.paperId))];
      const chunks = cited.length
        ? await hybridSearch(doc.workspaceId, s.text, { paperIds: cited, limit: 4, perPaperLimit: 2 })
        : await hybridSearch(doc.workspaceId, s.text, { limit: 3 });
      return { sentence: s, cited, chunks };
    }),
  );

  const results: ClaimCheck[] = [];
  for (let i = 0; i < prepared.length; i += 8) {
    const batch = prepared.slice(i, i + 8);
    const passages = new Map<string, CheckPassage>();
    const blocks = batch.map(({ sentence, cited, chunks }, j) => {
      const lines = chunks.map((chunk, k) => {
        const key = `P${j + 1}.${k + 1}`;
        passages.set(key, { key, chunk });
        return `  [${key}] ${chunk.paperTitle} (${chunk.locator} ${chunk.pageNumber}): ${chunk.text}`;
      });
      return `[S${j + 1}] ${sentence.text}\n  Cites: ${cited.length ? cited.length + " paper(s)" : "nothing"}\n  ${cited.length ? "Passages from the cited papers" : "Candidate passages from the library"}:\n${lines.join("\n") || "  (none found)"}`;
    });
    const res = await ctx.client.messages.parse({
      model: ctx.model,
      max_tokens: 8000,
      system: CHECK_SYSTEM,
      messages: [{ role: "user", content: `Sentences to check (ids S1…):\n\n${blocks.join("\n\n")}` }],
      output_config: { format: zodOutputFormat(CheckSchema) },
    });
    if (res.stop_reason === "refusal") throw new ReviewAiError("Claude declined to check this document.");
    const out = res.parsed_output?.results ?? [];
    batch.forEach(({ sentence, cited }, j) => {
      const r = out.find((x) => x.id === `S${j + 1}`);
      if (!r || r.verdict === "no_citation_needed") return;
      const passage = r.passage ? passages.get(r.passage.trim()) : undefined;
      // Only keep evidence whose quote really appears in the passage.
      const quoteFound = passage && r.quote && findHighlightRange(passage.chunk.text, r.quote);
      const evidence = quoteFound
        ? { paperId: passage.chunk.paperId, paperTitle: passage.chunk.paperTitle, page: passage.chunk.pageNumber, quote: r.quote.trim() }
        : undefined;
      let verdict = r.verdict as ClaimCheck["verdict"];
      let explanation = r.explanation.trim();
      if ((verdict === "supported" || verdict === "partly_supported") && !evidence) {
        verdict = "cannot_verify";
        explanation = `${explanation} The quoted evidence couldn't be found in the source, so treat this as unverified.`;
      }
      if (!cited.length && verdict !== "needs_citation") return;
      results.push({
        id: sentence.id,
        sentence: sentence.text,
        verdict,
        explanation,
        evidence: cited.length ? evidence : undefined,
        suggestion: !cited.length ? evidence : undefined,
      });
    });
  }

  await db().update(schema.document).set({ checks: results, checkedAt: new Date() }).where(eq(schema.document.id, docId));
  return results;
}
