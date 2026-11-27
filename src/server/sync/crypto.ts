import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Everything devices send each other is sealed with their shared 32-byte key
 * (AES-256-GCM, compressed first): unreadable on the network, and only a paired
 * device can produce a message the other accepts.
 * Layout: 12-byte IV | 16-byte tag | ciphertext.
 */
export function sealBytes(key: Buffer, data: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(gzipSync(data)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function openBytes(key: Buffer, box: Buffer): Buffer {
  if (box.length < 28) throw new Error("Sealed message too short");
  const d = createDecipheriv("aes-256-gcm", key, box.subarray(0, 12));
  d.setAuthTag(box.subarray(12, 28));
  return gunzipSync(Buffer.concat([d.update(box.subarray(28)), d.final()]));
}

export const seal = (key: Buffer, value: unknown) => sealBytes(key, Buffer.from(JSON.stringify(value)));
export const open = <T>(key: Buffer, box: Buffer): T => JSON.parse(openBytes(key, box).toString("utf8")) as T;

/** Messages older than this are refused, so a recorded request can't be replayed later. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
