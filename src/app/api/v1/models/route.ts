import { checkKeyAndListModels } from "@/lib/anthropic";
import { apiSession } from "@/server/session";
import { getApiKey } from "@/server/settings";

/** Claude models available to the signed-in user's own API key. */
export async function GET() {
  const { session, error } = await apiSession();
  if (error) return error;
  const key = await getApiKey(session.user.id);
  if (!key) return Response.json({ error: "no_api_key", models: [] }, { status: 409 });
  const result = await checkKeyAndListModels(key);
  if (!result.ok) return Response.json({ error: result.reason, message: result.message, models: [] }, { status: 502 });
  return Response.json({ models: result.models });
}
