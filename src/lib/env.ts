import { z } from "zod";

/**
 * Server environment, validated lazily so `next build` works without a
 * full runtime environment. Call `env()` at request time, never at module top level.
 */
const schema = z
  .object({
    /** Postgres for the server build. Unused by the desktop app, which embeds its own database. */
    DATABASE_URL: z.string().url().optional(),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 chars"),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
    /** 32-byte key, base64-encoded. Encrypts users' Anthropic API keys at rest. */
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "ENCRYPTION_KEY must be 32 bytes, base64"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    ORCID_CLIENT_ID: z.string().optional(),
    ORCID_CLIENT_SECRET: z.string().optional(),
    /** Use https://sandbox.orcid.org for development credentials. */
    ORCID_BASE_URL: z.string().url().default("https://orcid.org"),
    SMTP_URL: z.string().optional(),
    /** Where uploaded and imported PDFs are stored. */
    UPLOAD_DIR: z.string().default("./data/uploads"),
    /** Where the local embedding model is cached after first download. */
    MODEL_CACHE_DIR: z.string().default("./data/models"),
    /** Optional contact email sent to OpenAlex/Crossref for their "polite pool". */
    CONTACT_EMAIL: z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional()),
    EMAIL_FROM: z.string().default("Jobiza <no-reply@localhost>"),

    /* Desktop app only. The Electron shell sets these; never set them by hand. */
    JOBIZA_DESKTOP: z.enum(["0", "1"]).default("0"),
    /** Where the desktop app keeps its embedded database. */
    JOBIZA_DATA_DIR: z.string().optional(),
    /** Fresh secret per launch that lets the desktop window sign in to the local account. */
    JOBIZA_LAUNCH_TOKEN: z.string().min(32).optional(),
    JOBIZA_LOCAL_PASSWORD: z.string().min(32).optional(),
    JOBIZA_LOCAL_NAME: z.string().max(100).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.JOBIZA_DESKTOP === "1") {
      for (const k of ["JOBIZA_DATA_DIR", "JOBIZA_LAUNCH_TOKEN", "JOBIZA_LOCAL_PASSWORD"] as const)
        if (!v[k]) ctx.addIssue({ code: "custom", path: [k], message: "required in the desktop app" });
    } else if (!v.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "Invalid input: expected string, received undefined" });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** True inside the desktop app. Safe to call anywhere on the server (no validation). */
export const isDesktop = () => process.env.JOBIZA_DESKTOP === "1";

export const enabledProviders = () => {
  const e = env();
  return {
    google: Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
    orcid: Boolean(e.ORCID_CLIENT_ID && e.ORCID_CLIENT_SECRET),
  };
};
