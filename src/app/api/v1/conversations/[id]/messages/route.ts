import { z } from "zod";
import { answerQuestion } from "@/server/chat";
import { errorResponse } from "@/server/http";
import { apiSession } from "@/server/session";

const body = z.object({ question: z.string().trim().min(1).max(4000) });

/**
 * Ask a question. Responds with Server-Sent Events:
 * `sources`, then `text` deltas, then `done` (final text + citations) or `error`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Type a question first." }, { status: 400 });
  const { id } = await ctx.params;

  let events: AsyncGenerator<unknown>;
  try {
    events = answerQuestion(session.user.id, id, parsed.data.question, req.signal);
    // Run up to the first event so ownership errors become proper HTTP errors.
    const first = await events.next();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        try {
          if (!first.done) send(first.value);
          for await (const event of events) send(event);
        } catch (err) {
          console.error("[chat] stream failed:", err);
          send({ type: "error", error: "Something went wrong while answering. Try again." });
        } finally {
          controller.close();
        }
      },
      cancel() {
        void events.return(undefined);
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
