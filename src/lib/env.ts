import { z } from "zod";

/**
 * Server environment, validated lazily so `next build` works without a
 * full runtime environment. Call `env()` at request time, never at module top level.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
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

export const enabledProviders = () => {
  const e = env();
  return {
    google: Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
    orcid: Boolean(e.ORCID_CLIENT_ID && e.ORCID_CLIENT_SECRET),
  };
};
