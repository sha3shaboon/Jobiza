import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { db, pglite, schema } from "@/db";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { startInbox } from "./inbox";
import { enqueueIngest } from "./queue";

/**
 * Desktop app start-up: everything the server's `migrate` service, worker and
 * sign-up flow do, for a single person on their own computer.
 */

/** The one account on a desktop install. The address is never used for email. */
export const LOCAL_EMAIL = "you@desktop.invalid";

const RUNNING_REVIEW = ["searching", "screening", "retrieving", "extracting", "synthesizing"] as const;

/**
 * Applies ./drizzle migrations to the embedded database. Each file runs as one
 * multi-statement script (PGlite can't prepare several statements at once).
 */
async function migrate() {
  const client = pglite()!;
  await client.exec(`CREATE TABLE IF NOT EXISTS jobiza_migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.join(process.cwd(), "drizzle");
  const journal = JSON.parse(await fs.readFile(path.join(dir, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const done = new Set((await client.query<{ tag: string }>("SELECT tag FROM jobiza_migrations")).rows.map((r) => r.tag));
  for (const { tag } of journal.entries) {
    if (done.has(tag)) continue;
    const sql = (await fs.readFile(path.join(dir, `${tag}.sql`), "utf8")).replaceAll("--> statement-breakpoint", "");
    await client.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO jobiza_migrations (tag) VALUES ($1)", [tag]);
    });
    console.info(`[desktop] applied migration ${tag}`);
  }
}

/** Creates the local account on first run, and keeps its password in step with the app's secret store. */
async function ensureLocalUser() {
  const e = env();
  const name = e.JOBIZA_LOCAL_NAME?.trim() || "You";
  let user = await db().query.user.findFirst({ where: eq(schema.user.email, LOCAL_EMAIL) });
  if (!user) {
    await auth().api.signUpEmail({ body: { email: LOCAL_EMAIL, password: e.JOBIZA_LOCAL_PASSWORD!, name } });
    await db().update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, LOCAL_EMAIL));
    console.info("[desktop] created the local account");
    return;
  }
  // The password lives in the OS keychain-protected secret file. If that was reset, re-key the account.
  const ctx = await auth().$context;
  const hash = await ctx.password.hash(e.JOBIZA_LOCAL_PASSWORD!);
  await db()
    .update(schema.account)
    .set({ password: hash })
    .where(and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential")));
  if (user.name !== name && name !== "You") {
    user = { ...user, name };
    await db().update(schema.user).set({ name }).where(eq(schema.user.id, user.id));
  }
}

/** Jobs don't survive the app closing: re-queue paper processing, and mark interrupted review steps for a re-run. */
async function recoverJobs() {
  const papers = await db()
    .update(schema.paper)
    .set({ status: "queued" })
    .where(inArray(schema.paper.status, ["queued", "processing"]))
    .returning({ id: schema.paper.id });
  for (const p of papers) await enqueueIngest(p.id);
  if (papers.length) console.info(`[desktop] resumed processing ${papers.length} paper(s)`);

  // Review steps call Claude on the user's key, so they're never re-run without asking.
  await db()
    .update(schema.review)
    .set({ status: "failed", statusDetail: "Jobiza was closed while this step was running. Run it again to continue." })
    .where(inArray(schema.review.status, [...RUNNING_REVIEW]));
}

export async function bootstrapDesktop() {
  const t = Date.now();
  await migrate();
  await ensureLocalUser();
  await recoverJobs();
  await startInbox(LOCAL_EMAIL);
  console.info(`[desktop] ready in ${Date.now() - t} ms`);
}
