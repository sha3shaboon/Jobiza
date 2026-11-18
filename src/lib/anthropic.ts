import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export type ModelOption = { id: string; displayName: string; createdAt: string };

export type KeyCheck =
  | { ok: true; models: ModelOption[] }
  | { ok: false; reason: "invalid" | "permission" | "rate_limited" | "unreachable"; message: string };

export function clientFor(apiKey: string) {
  return new Anthropic({ apiKey, maxRetries: 2 });
}

/**
 * Validates a user-supplied key with a free Models API call (no tokens spent)
 * and returns the Claude models that key can use, newest first.
 */
export async function checkKeyAndListModels(apiKey: string): Promise<KeyCheck> {
  const client = clientFor(apiKey);
  try {
    const models: ModelOption[] = [];
    for await (const m of client.models.list({ limit: 100 })) {
      models.push({ id: m.id, displayName: m.display_name, createdAt: m.created_at });
    }
    models.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, models };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, reason: "invalid", message: "Anthropic rejected this API key." };
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, reason: "permission", message: "This key isn't allowed to list models." };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, reason: "rate_limited", message: "Rate limited by Anthropic. Try again shortly." };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, reason: "unreachable", message: `Anthropic API error (${err.status ?? "network"}).` };
    }
    throw err;
  }
}

export function looksLikeAnthropicKey(key: string) {
  return /^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(key.trim());
}
