import { z } from "zod";
import { checkKeyAndListModels } from "@/lib/anthropic";
import { CITATION_STYLES } from "@/lib/citation-styles";
import { apiSession } from "@/server/session";
import { getApiKey, getSettings, updatePreferences } from "@/server/settings";

export async function GET() {
  const { session, error } = await apiSession();
  if (error) return error;
  return Response.json(await getSettings(session.user.id));
}

const patchSchema = z.object({
  model: z.string().min(1).max(100).optional(),
  citationStyle: z.enum(CITATION_STYLES.map((s) => s.id) as [string, ...string[]]).optional(),
});

export async function PATCH(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });

  if (parsed.data.model) {
    const key = await getApiKey(session.user.id);
    if (!key) return Response.json({ error: "no_api_key" }, { status: 409 });
    const check = await checkKeyAndListModels(key);
    if (!check.ok) return Response.json({ error: check.reason, message: check.message }, { status: 502 });
    if (!check.models.some((m) => m.id === parsed.data.model)) {
      return Response.json({ error: "unknown_model", message: "Your API key can't use that model." }, { status: 400 });
    }
  }
  await updatePreferences(session.user.id, parsed.data);
  return Response.json(await getSettings(session.user.id));
}
