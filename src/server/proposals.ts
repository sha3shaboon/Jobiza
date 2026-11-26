import "server-only";
import { randomUUID } from "node:crypto";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ProposalPlan } from "@/db/schema";
import { buildAnswer, searchResultBlocks, toSource } from "@/lib/chat/answer";
import type { DocNode } from "@/lib/writing/doc";
import { PROPOSAL_TEMPLATES } from "@/lib/writing/proposal-templates";
import { answerToNodes } from "@/lib/writing/draft";
import { ownedDocument } from "./documents";
import { LibraryError, workspaceFor } from "./library";
import { hybridSearch } from "./retrieval";
import { claudeFor, ReviewAiError } from "./review-ai";
import { ownedReview } from "./reviews";
import { getSettings } from "./settings";

/* ───────────── Planning ───────────── */

export const BriefSchema = z.object({
  type: z.enum(["thesis", "grant", "protocol"]),
  topic: z.string().trim().min(3).max(300),
  question: z.string().trim().max(600).default(""),
  field: z.string().trim().max(120).default(""),
  timeframe: z.string().trim().max(60).default("12 months"),
  length: z.enum(["short", "full"]).default("full"),
  reviewId: z.string().uuid().nullable().default(null),
  scopePaperIds: z.array(z.string().uuid()).max(200).default([]),
});
export type ProposalBrief = z.infer<typeof BriefSchema>;

const OutlineSchema = z.object({
  title: z.string().describe("A specific working title for the proposal, under 120 characters"),
  researchQuestions: z.array(z.string()).describe("1 to 3 focused, answerable research questions"),
  aims: z.array(z.string()).describe("2 to 4 aims or objectives, each one sentence"),
  sections: z
    .array(
      z.object({
        heading: z.string().describe("Section heading, a few words"),
        guidance: z.string().describe("1-2 sentences on what this section should say for THIS topic"),
        cites: z.boolean().describe("True when the section discusses existing research and should cite the library"),
      }),
    )
    .describe("The proposal's sections in order"),
});

const PLAN_SYSTEM = `You help students and researchers plan research proposals.
Given a brief, a template outline, and the titles of papers in the researcher's library, produce a working title, focused research questions, aims, and the section outline.
Keep the template's sections unless the topic clearly calls for a change (rename, merge, or add at most two). For each section, write guidance that is specific to this topic: what it should argue or describe, not generic advice.
Research questions must be answerable with the time frame given. Don't invent findings.`;

/** Context from a linked literature review: its question and synthesis, plus the papers it read. */
async function reviewContext(userId: string, reviewId: string | null) {
  if (!reviewId) return { text: "", paperIds: [] as string[] };
  const review = await ownedReview(userId, reviewId);
  const read = await db().query.reviewRecord.findMany({
    where: and(
      eq(schema.reviewRecord.reviewId, reviewId),
      eq(schema.reviewRecord.screening, "included"),
      inArray(schema.reviewRecord.fullText, ["retrieved", "abstract_only"]),
      isNotNull(schema.reviewRecord.paperId),
    ),
    orderBy: [asc(schema.reviewRecord.rank)],
  });
  const synthesis = (review.synthesis ?? "").slice(0, 6000);
  const text = `Linked literature review: "${review.title}". Question: ${review.question}${synthesis ? `\nIts synthesis of the evidence:\n${synthesis}` : ""}`;
  return { text, paperIds: read.map((r) => r.paperId!) };
}

function briefText(b: ProposalBrief | ProposalPlan) {
  const t = PROPOSAL_TEMPLATES[b.type];
  return [
    `Proposal type: ${t.label}`,
    `Topic: ${b.topic}`,
    b.question && `Main research question (from the researcher): ${b.question}`,
    b.field && `Field: ${b.field}`,
    `Time frame: ${b.timeframe}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Claude turns the brief into an outline the user reviews before anything is written. */
export async function planProposal(userId: string, brief: ProposalBrief) {
  const ctx = await claudeFor(userId);
  const ws = await workspaceFor(userId);
  const review = await reviewContext(userId, brief.reviewId);
  const titles = await db()
    .select({ title: schema.paper.title, year: schema.paper.year })
    .from(schema.paper)
    .where(and(eq(schema.paper.workspaceId, ws.id), eq(schema.paper.status, "ready")))
    .limit(80);
  const template = PROPOSAL_TEMPLATES[brief.type].sections.map((s, i) => `${i + 1}. ${s.heading}: ${s.guidance}${s.cites ? " (cites literature)" : ""}`).join("\n");
  const res = await ctx.client.messages.parse({
    model: ctx.model,
    max_tokens: 6000,
    system: PLAN_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          briefText(brief),
          `Template outline:\n${template}`,
          titles.length ? `Papers in the library:\n${titles.map((p) => `- ${p.title}${p.year ? ` (${p.year})` : ""}`).join("\n")}` : "The library is empty.",
          review.text,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    output_config: { format: zodOutputFormat(OutlineSchema) },
  });
  if (res.stop_reason === "refusal") throw new ReviewAiError("Claude declined to plan this proposal.");
  const out = res.parsed_output;
  if (!out?.sections.length) throw new ReviewAiError("Claude's outline couldn't be read. Try again.");
  const plan: ProposalPlan = {
    ...brief,
    researchQuestions: out.researchQuestions.slice(0, 5),
    aims: out.aims.slice(0, 6),
    sections: out.sections.slice(0, 14).map((s) => ({ id: randomUUID(), heading: s.heading.slice(0, 120), guidance: s.guidance.slice(0, 600), cites: s.cites })),
  };
  return { title: out.title.slice(0, 200), plan };
}

/* ───────────── The document ───────────── */

export const PlanSchema = BriefSchema.extend({
  researchQuestions: z.array(z.string().trim().min(1).max(400)).max(6),
  aims: z.array(z.string().trim().min(1).max(400)).max(8),
  sections: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        heading: z.string().trim().min(1).max(120),
        guidance: z.string().trim().max(1000),
        cites: z.boolean(),
      }),
    )
    .min(1)
    .max(20),
});

/** The empty proposal: every section heading, ready to be written. */
function outlineDoc(plan: ProposalPlan): DocNode {
  return {
    type: "doc",
    content: plan.sections.flatMap((s) => [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: s.heading }] },
      { type: "paragraph" },
    ]),
  };
}

export async function createProposal(userId: string, title: string, plan: ProposalPlan) {
  const ws = await workspaceFor(userId);
  if (plan.reviewId) await ownedReview(userId, plan.reviewId);
  const style = (await getSettings(userId)).citationStyle;
  const [row] = await db()
    .insert(schema.document)
    .values({
      id: randomUUID(),
      workspaceId: ws.id,
      userId,
      title: title.trim() || plan.topic,
      kind: "proposal",
      proposal: plan,
      content: outlineDoc(plan),
      citationStyle: style,
    })
    .returning();
  return row;
}

/* ───────────── Writing a section ───────────── */

const SECTION_SYSTEM = `You help a student or researcher write their research proposal, one section at a time. The passages provided as search results are the only evidence about existing research you may use.
- When you state what prior research found or argued, cite the passages. Never invent studies, findings, numbers or sources. If the passages don't cover something the section needs, say briefly what evidence is still needed.
- For the researcher's own plan (questions, aims, design, sample, procedure, analysis, ethics, timeline, budget), write concrete, realistic proposals in the future tense that fit the brief and time frame. Put choices the researcher must confirm or fill in inside [square brackets], e.g. [target sample: confirm with a power analysis].
- Stay consistent with the research questions, aims and the sections already written.
- Write plain prose paragraphs separated by blank lines. Use lines starting with "- " for lists (aims, objectives, phases, milestones). No headings, bold, tables, title or reference list: the editor adds those.`;

const LENGTH = { short: "about 150 to 250 words", full: "about 350 to 600 words" } as const;

export async function draftProposalSection(userId: string, docId: string, sectionId: string, opts: { priorText?: string; note?: string } = {}) {
  const doc = await ownedDocument(userId, docId);
  const plan = doc.proposal;
  if (doc.kind !== "proposal" || !plan) throw new LibraryError("This document isn't a proposal.", 400);
  const section = plan.sections.find((s) => s.id === sectionId);
  if (!section) throw new LibraryError("Section not found.", 404);
  const ctx = await claudeFor(userId);
  const review = await reviewContext(userId, plan.reviewId);
  const scope = plan.scopePaperIds.length ? plan.scopePaperIds : review.paperIds;

  // Sections about the plan itself still get a few passages, for methods precedents.
  const query = `${plan.topic}. ${plan.question} ${section.heading}: ${section.guidance}`;
  const chunks = await hybridSearch(doc.workspaceId, query, { paperIds: scope, limit: section.cites ? 14 : 6 });
  const sources = chunks.map(toSource);

  const outline = plan.sections.map((s, i) => `${i + 1}. ${s.heading}${s.id === section.id ? "  ← this section" : ""}`).join("\n");
  const prompt = [
    briefText(plan),
    plan.researchQuestions.length && `Research questions:\n${plan.researchQuestions.map((q) => `- ${q}`).join("\n")}`,
    plan.aims.length && `Aims:\n${plan.aims.map((a) => `- ${a}`).join("\n")}`,
    `Outline:\n${outline}`,
    review.text,
    opts.priorText?.trim() && `Sections written so far (for consistency; don't repeat them):\n${opts.priorText.trim().slice(-6000)}`,
    !sources.length && "No passages from the library match this section. Don't cite anything; say what evidence the researcher should add, if the section needs it.",
    `Write the section "${section.heading}" for the proposal titled "${doc.title}". It should cover: ${section.guidance}\nLength: ${LENGTH[plan.length]}.`,
    opts.note?.trim() && `The researcher's request for this version: ${opts.note.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await ctx.client.messages
    .stream({
      model: ctx.model,
      max_tokens: 12000,
      system: SECTION_SYSTEM,
      messages: [{ role: "user", content: [...searchResultBlocks(sources), { type: "text", text: prompt }] }],
    })
    .finalMessage();
  if (res.stop_reason === "refusal") throw new ReviewAiError("Claude declined to write this section.");
  const answer = buildAnswer(res.content, sources);
  return { nodes: answerToNodes(answer.text, answer.citations, randomUUID), citations: answer.citations.length };
}
