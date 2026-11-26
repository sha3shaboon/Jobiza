import { z } from "zod";
import { STYLE_FILES } from "@/server/citations";
import { deleteDocument, ownedDocument, updateDocument } from "@/server/documents";
import { errorResponse } from "@/server/http";
import { apiSession } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    const d = await ownedDocument(session.user.id, (await ctx.params).id);
    return Response.json({
      document: { id: d.id, title: d.title, kind: d.kind, proposal: d.proposal, content: d.content, citationStyle: d.citationStyle, checks: d.checks, checkedAt: d.checkedAt?.toISOString() ?? null, updatedAt: d.updatedAt.toISOString() },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** ProseMirror JSON is validated loosely: a doc node with content, bounded in size. */
const docNode = z.object({ type: z.literal("doc"), content: z.array(z.record(z.string(), z.unknown())).max(5000) }).passthrough();
const patch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: docNode.optional(),
  citationStyle: z.enum(Object.keys(STYLE_FILES) as [string, ...string[]]).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { session, error } = await apiSession();
  if (error) return error;
  const raw = await req.text();
  if (raw.length > 5_000_000) return Response.json({ error: "This document is too large to save." }, { status: 413 });
  const parsed = patch.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!parsed.success) return Response.json({ error: "Invalid document." }, { status: 400 });
  try {
    const updatedAt = await updateDocument(session.user.id, (await ctx.params).id, parsed.data as Parameters<typeof updateDocument>[2]);
    return Response.json({ updatedAt });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    await deleteDocument(session.user.id, (await ctx.params).id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
