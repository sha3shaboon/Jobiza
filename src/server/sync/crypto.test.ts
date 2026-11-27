import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { open, openBytes, seal, sealBytes } = await import("./crypto");

describe("sync sealing", () => {
  const key = randomBytes(32);

  it("round-trips JSON and bytes", () => {
    const value = { since: 42, rows: [{ id: "a", text: "Sleep après l'apprentissage", vec: [0.1, -0.2] }] };
    expect(open(key, seal(key, value))).toEqual(value);
    const bytes = randomBytes(5000);
    expect(openBytes(key, sealBytes(key, bytes)).equals(bytes)).toBe(true);
  });

  it("uses a fresh IV each time", () => {
    expect(seal(key, { a: 1 }).equals(seal(key, { a: 1 }))).toBe(false);
  });

  it("rejects another device's key", () => {
    expect(() => open(randomBytes(32), seal(key, { a: 1 }))).toThrow();
  });

  it("detects tampering", () => {
    const box = seal(key, { a: 1 });
    box[box.length - 1] ^= 1;
    expect(() => open(key, box)).toThrow();
    expect(() => open(key, Buffer.alloc(10))).toThrow();
  });
});
