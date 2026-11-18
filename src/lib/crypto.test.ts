import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("secret encryption", () => {
  it("round-trips", () => {
    const ct = encryptSecret("sk-ant-test-123", key, "user-1");
    expect(ct.startsWith("v1.")).toBe(true);
    expect(ct).not.toContain("sk-ant");
    expect(decryptSecret(ct, key, "user-1")).toBe("sk-ant-test-123");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("x", key, "u")).not.toBe(encryptSecret("x", key, "u"));
  });

  it("rejects a ciphertext moved to another user", () => {
    const ct = encryptSecret("sk-ant-test", key, "user-1");
    expect(() => decryptSecret(ct, key, "user-2")).toThrow();
  });

  it("rejects tampering and wrong keys", () => {
    const ct = encryptSecret("sk-ant-test", key, "u");
    const parts = ct.split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join("."), key, "u")).toThrow();
    expect(() => decryptSecret(ct, randomBytes(32).toString("base64"), "u")).toThrow();
  });
});
