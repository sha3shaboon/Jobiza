import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for secrets at rest (users' Anthropic API keys).
 * Format: v1.<iv b64>.<auth tag b64>.<ciphertext b64>
 * `aad` binds a ciphertext to its owner so it can't be swapped between rows.
 */
const VERSION = "v1";

function keyFrom(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");
  return key;
}

export function encryptSecret(plaintext: string, keyB64: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(keyB64), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(payload: string, keyB64: string, aad: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) throw new Error("Unrecognized ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(keyB64), Buffer.from(ivB64, "base64"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
