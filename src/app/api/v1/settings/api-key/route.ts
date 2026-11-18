import { z } from "zod";
import { looksLikeAnthropicKey } from "@/lib/anthropic";
import { apiSession } from "@/server/session";
import { deleteApiKey, getSettings, saveApiKey } from "@/server/settings";

const bodySchema = z.object({ apiKey: z.string().min(1).max(500) });

export async function PUT(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !looksLikeAnthropicKey(parsed.data.apiKey)) {
    return Response.json(
      { error: "invalid_format", message: "That doesn't look like an Anthropic API key (sk-ant-…)." },
      { status: 400 },
    );
  }
  const result = await saveApiKey(session.user.id, parsed.data.apiKey);
  if (!result.ok) {
    const status = result.reason === "invalid" || result.reason === "permission" ? 400 : 502;
    return Response.json({ error: result.reason, message: result.message }, { status });
  }
  return Response.json({ settings: await getSettings(session.user.id), models: result.models });
}

export async function DELETE() {
  const { session, error } = await apiSession();
  if (error) return error;
  await deleteApiKey(session.user.id);
  return Response.json(await getSettings(session.user.id));
}
