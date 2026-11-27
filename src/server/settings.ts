import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { checkKeyAndListModels, type KeyCheck } from "@/lib/anthropic";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";

const aadFor = (userId: string) => `anthropic-key:${userId}`;

export type PublicSettings = {
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  apiKeyVerifiedAt: string | null;
  model: string | null;
  citationStyle: string;
};

export async function getSettings(userId: string): Promise<PublicSettings> {
  const row = await db().query.userSettings.findFirst({ where: eq(schema.userSettings.userId, userId) });
  return {
    hasApiKey: Boolean(row?.anthropicKeyCiphertext),
    apiKeyLast4: row?.anthropicKeyLast4 ?? null,
    apiKeyVerifiedAt: row?.anthropicKeyVerifiedAt?.toISOString() ?? null,
    model: row?.model ?? null,
    citationStyle: row?.citationStyle ?? "apa",
  };
}

/** Server-side only: never return this to a client. */
export async function getApiKey(userId: string): Promise<string | null> {
  const row = await db().query.userSettings.findFirst({ where: eq(schema.userSettings.userId, userId) });
  if (!row?.anthropicKeyCiphertext) return null;
  return decryptSecret(row.anthropicKeyCiphertext, env().ENCRYPTION_KEY, aadFor(userId));
}

/** Verifies the key against Anthropic, then stores it encrypted. */
export async function saveApiKey(userId: string, apiKey: string): Promise<KeyCheck> {
  const key = apiKey.trim();
  const check = await checkKeyAndListModels(key);
  if (!check.ok) return check;

  const current = await getSettings(userId);
  const ids = check.models.map((m) => m.id);
  // Keep the chosen model if this key can use it; otherwise default to the newest model.
  const model = current.model && ids.includes(current.model) ? current.model : (ids[0] ?? null);

  await db()
    .insert(schema.userSettings)
    .values({
      userId,
      anthropicKeyCiphertext: encryptSecret(key, env().ENCRYPTION_KEY, aadFor(userId)),
      anthropicKeyLast4: key.slice(-4),
      anthropicKeyVerifiedAt: new Date(),
      model,
    })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: {
        anthropicKeyCiphertext: encryptSecret(key, env().ENCRYPTION_KEY, aadFor(userId)),
        anthropicKeyLast4: key.slice(-4),
        anthropicKeyVerifiedAt: new Date(),
        model,
      },
    });
  return check;
}

export async function deleteApiKey(userId: string) {
  await db()
    .update(schema.userSettings)
    .set({ anthropicKeyCiphertext: null, anthropicKeyLast4: null, anthropicKeyVerifiedAt: null })
    .where(eq(schema.userSettings.userId, userId));
}

export async function updatePreferences(userId: string, prefs: { model?: string; citationStyle?: string }) {
  await db()
    .insert(schema.userSettings)
    .values({ userId, ...prefs })
    .onConflictDoUpdate({ target: schema.userSettings.userId, set: prefs });
}

/** Stores a key another of the user's devices already verified (device pairing); no network check. */
export async function storeVerifiedApiKey(userId: string, apiKey: string, verifiedAt: Date) {
  const key = apiKey.trim();
  const values = {
    anthropicKeyCiphertext: encryptSecret(key, env().ENCRYPTION_KEY, aadFor(userId)),
    anthropicKeyLast4: key.slice(-4),
    anthropicKeyVerifiedAt: verifiedAt,
  };
  await db()
    .insert(schema.userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.userSettings.userId, set: values });
}
