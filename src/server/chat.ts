import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildAnswer, searchResultBlocks, toSource, type Source } from "@/lib/chat/answer";
import { LibraryError, readyPaperIds, workspaceFor } from "./library";
import { hybridSearch } from "./retrieval";
import { getApiKey, getSettings } from "./settings";

const SYSTEM_PROMPT = `You are Jobiza, a research assistant for students and academics. You answer questions using only the passages from the user's own library that are provided with each question as search results.

How to answer:
- Base every factual statement on the provided passages, and cite them. If the passages don't contain the answer, say so plainly and suggest what kind of source would help. Do not fill gaps from general knowledge.
- Refer to papers by author and year in your prose (for example "Rahman et al. (2024) found…") so the reader can follow the argument without opening the sources.
- When sources disagree or use different methods, say so and explain the difference.
- Be concise: lead with the direct answer, then the supporting detail. Use short paragraphs; use a list only when comparing several items.
- Write plain text. Don't use Markdown headings, bold or tables. For a list, start each item on its own line with "- ".
- Write in the language of the question.`;

/** Turns of earlier conversation to resend (as plain text). */
const HISTORY_TURNS = 6;

export type ConversationSummary = { id: string; title: string; scopePaperIds: string[]; updatedAt: string };

function toConversationSummary(c: typeof schema.conversation.$inferSelect): ConversationSummary {
  return { id: c.id, title: c.title, scopePaperIds: c.scopePaperIds, updatedAt: c.updatedAt.toISOString() };
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const rows = await db().query.conversation.findMany({
    where: eq(schema.conversation.userId, userId),
    orderBy: [desc(schema.conversation.updatedAt)],
    limit: 100,
  });
  return rows.map(toConversationSummary);
}

async function ownedConversation(userId: string, id: string) {
  const row = await db().query.conversation.findFirst({
    where: and(eq(schema.conversation.id, id), eq(schema.conversation.userId, userId)),
  });
  if (!row) throw new LibraryError("Conversation not found.", 404);
  return row;
}

export async function getConversation(userId: string, id: string) {
  const conv = await ownedConversation(userId, id);
  const messages = await db().query.message.findMany({
    where: eq(schema.message.conversationId, id),
    orderBy: [asc(schema.message.createdAt)],
  });
  return {
    ...toConversationSummary(conv),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      citations: m.citations,
      error: m.error,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function createConversation(userId: string, scopePaperIds: string[] = []) {
  const ws = await workspaceFor(userId);
  const scope = scopePaperIds.length ? await readyPaperIds(ws.id, scopePaperIds) : [];
  const [row] = await db()
    .insert(schema.conversation)
    .values({ id: randomUUID(), workspaceId: ws.id, userId, scopePaperIds: scope })
    .returning();
  return toConversationSummary(row);
}

export async function updateConversationScope(userId: string, id: string, scopePaperIds: string[]) {
  const conv = await ownedConversation(userId, id);
  const scope = scopePaperIds.length ? await readyPaperIds(conv.workspaceId, scopePaperIds) : [];
  const [row] = await db()
    .update(schema.conversation)
    .set({ scopePaperIds: scope })
    .where(eq(schema.conversation.id, id))
    .returning();
  return toConversationSummary(row);
}

export async function deleteConversation(userId: string, id: string) {
  await ownedConversation(userId, id);
  await db().delete(schema.conversation).where(eq(schema.conversation.id, id));
}

export type ChatEvent =
  | { type: "sources"; sources: { paperId: string; paperTitle: string; pageNumber: number }[] }
  | { type: "text"; text: string }
  | {
      type: "done";
      message: { id: string; content: string; citations: schema.MessageCitation[]; error: string | null };
    }
  | { type: "error"; error: string };

function friendlyApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic rejected your API key. Update it in Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return "Your API key can't use the selected model. Pick another model in Settings.";
  if (err instanceof Anthropic.NotFoundError) return "The selected model isn't available. Pick another model in Settings.";
  if (err instanceof Anthropic.RateLimitError) return "Anthropic's rate limit was reached for your key. Wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError && /credit|billing/i.test(err.message)) {
    return "Your Anthropic account is out of credit. Add credit in the Claude Console.";
  }
  if (err instanceof Anthropic.APIError) return "Claude couldn't answer right now. Try again in a moment.";
  return "Something went wrong while answering. Try again.";
}

/**
 * Answer a question in a conversation. Yields events for streaming to the
 * client and persists both the question and the final cited answer.
 */
export async function* answerQuestion(
  userId: string,
  conversationId: string,
  question: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const conv = await ownedConversation(userId, conversationId);
  const d = db();

  const history = await d.query.message.findMany({
    where: eq(schema.message.conversationId, conversationId),
    orderBy: [desc(schema.message.createdAt)],
    limit: HISTORY_TURNS * 2,
  });
  history.reverse();

  await d.insert(schema.message).values({ id: randomUUID(), conversationId, role: "user", content: question });
  const isFirst = history.length === 0;
  await d
    .update(schema.conversation)
    .set({ title: isFirst ? question.replace(/\s+/g, " ").slice(0, 80) : conv.title, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId));

  const assistantId = randomUUID();
  const fail = async (error: string): Promise<ChatEvent> => {
    await d.insert(schema.message).values({ id: assistantId, conversationId, role: "assistant", content: "", error });
    return { type: "error", error };
  };

  const [apiKey, settings] = await Promise.all([getApiKey(userId), getSettings(userId)]);
  if (!apiKey || !settings.model) {
    yield await fail("Add your Anthropic API key and choose a model in Settings to ask questions.");
    return;
  }

  // Follow-ups like "what about adults?" need the previous question for context.
  const lastQuestion = [...history].reverse().find((m) => m.role === "user")?.content;
  const searchText = lastQuestion && question.length < 120 ? `${lastQuestion}\n${question}` : question;
  const chunks = await hybridSearch(conv.workspaceId, searchText, { paperIds: conv.scopePaperIds });
  if (!chunks.length) {
    const anyReady = (await readyPaperIds(conv.workspaceId)).length > 0;
    yield await fail(
      anyReady
        ? "Nothing in the selected papers matches that question. Try rephrasing it or widening the papers you're asking."
        : "Your library has no processed papers yet. Add a paper, wait for it to finish processing, then ask again.",
    );
    return;
  }
  const sources: Source[] = chunks.map(toSource);
  yield {
    type: "sources",
    sources: sources.map((s) => ({ paperId: s.paperId, paperTitle: s.paperTitle, pageNumber: s.pageNumber })),
  };

  const messages: Anthropic.MessageParam[] = [];
  for (const m of history) {
    if (m.role === "assistant" && !m.content) continue; // failed turns
    messages.push({ role: m.role, content: m.content });
  }
  // Keep strict user/assistant alternation if a previous answer failed.
  const merged: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    const prev = merged.at(-1);
    if (prev && prev.role === m.role && typeof prev.content === "string" && typeof m.content === "string") {
      prev.content = `${prev.content}\n\n${m.content}`;
    } else merged.push(m);
  }
  if (merged[0]?.role === "assistant") merged.shift();
  if (merged.at(-1)?.role === "user") merged.pop();
  merged.push({ role: "user", content: [...searchResultBlocks(sources), { type: "text", text: question }] });

  const client = new Anthropic({ apiKey, maxRetries: 2 });
  try {
    const stream = client.messages.stream(
      { model: settings.model, max_tokens: 8000, system: SYSTEM_PROMPT, messages: merged },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    const answer = buildAnswer(final.content, sources);
    let error: string | null = null;
    if (final.stop_reason === "refusal") error = "Claude declined to answer this question.";
    else if (final.stop_reason === "max_tokens") error = "The answer was cut short because it reached the length limit.";
    await d.insert(schema.message).values({
      id: assistantId,
      conversationId,
      role: "assistant",
      content: answer.text,
      citations: answer.citations,
      model: settings.model,
      error,
    });
    yield { type: "done", message: { id: assistantId, content: answer.text, citations: answer.citations, error } };
  } catch (err) {
    if (signal?.aborted) {
      await fail("Stopped.").catch(() => undefined);
      return;
    }
    console.error("[chat] answer failed:", err);
    yield await fail(friendlyApiError(err));
  }
}
