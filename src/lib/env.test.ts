import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

describe("env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("treats a blank CONTACT_EMAIL as unset (as in .env.example)", async () => {
    for (const [k, v] of Object.entries({ ...base, CONTACT_EMAIL: "" })) vi.stubEnv(k, v);
    const { env } = await import("./env");
    expect(env().CONTACT_EMAIL).toBeUndefined();
    expect(env().UPLOAD_DIR).toBe("./data/uploads");
  });

  it("rejects a malformed encryption key", async () => {
    for (const [k, v] of Object.entries({ ...base, ENCRYPTION_KEY: "short" })) vi.stubEnv(k, v);
    const { env } = await import("./env");
    expect(() => env()).toThrow(/ENCRYPTION_KEY/);
  });
});
