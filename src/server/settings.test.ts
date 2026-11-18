/**
 * Integration test for the bring-your-own-key flow against a real Postgres.
 * Skipped unless DATABASE_URL is set (run migrations first). Only the
 * Anthropic network call is mocked.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/anthropic", () => ({
  checkKeyAndListModels: vi.fn(async (key: string) =>
    key.endsWith("good")
      ? {
          ok: true,
          models: [
            { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", createdAt: "2026-10-01T00:00:00Z" },
            { id: "claude-sonnet-5-5", displayName: "Claude Sonnet 5.5", createdAt: "2026-09-01T00:00:00Z" },
          ],
        }
      : { ok: false, reason: "invalid", message: "Anthropic rejected this API key." },
  ),
}));

const run = process.env.DATABASE_URL ? describe : describe.skip;

run("BYOK settings (integration)", () => {
  const userId = `test-${randomUUID()}`;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString("base64");
    const { db, schema } = await import("@/db");
    await db().insert(schema.user).values({ id: userId, name: "Test User", email: `${userId}@example.com` });
  });

  it("refuses to store a key Anthropic rejects", async () => {
    const { saveApiKey, getSettings } = await import("./settings");
    const r = await saveApiKey(userId, "sk-ant-api03-bad");
    expect(r.ok).toBe(false);
    expect((await getSettings(userId)).hasApiKey).toBe(false);
  });

  it("stores a valid key encrypted, defaults the model, and decrypts it server-side", async () => {
    const { saveApiKey, getSettings, getApiKey } = await import("./settings");
    const { db, schema } = await import("@/db");
    const key = "sk-ant-api03-xyz-good";
    const r = await saveApiKey(userId, key);
    expect(r.ok).toBe(true);

    const s = await getSettings(userId);
    expect(s).toMatchObject({ hasApiKey: true, apiKeyLast4: "good", model: "claude-opus-5-5" });
    expect(JSON.stringify(s)).not.toContain("sk-ant");

    const row = await db().query.userSettings.findFirst({ where: eq(schema.userSettings.userId, userId) });
    expect(row?.anthropicKeyCiphertext).toMatch(/^v1\./);
    expect(row?.anthropicKeyCiphertext).not.toContain(key);
    expect(await getApiKey(userId)).toBe(key);
  });

  it("keeps the chosen model when the key is replaced", async () => {
    const { saveApiKey, updatePreferences, getSettings } = await import("./settings");
    await updatePreferences(userId, { model: "claude-sonnet-5-5" });
    await saveApiKey(userId, "sk-ant-api03-other-good");
    expect((await getSettings(userId)).model).toBe("claude-sonnet-5-5");
  });

  it("deletes the key", async () => {
    const { deleteApiKey, getSettings, getApiKey } = await import("./settings");
    await deleteApiKey(userId);
    expect((await getSettings(userId)).hasApiKey).toBe(false);
    expect(await getApiKey(userId)).toBeNull();
    const { db, schema } = await import("@/db");
    await db().delete(schema.user).where(eq(schema.user.id, userId));
  });
});
