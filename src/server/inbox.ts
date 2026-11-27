import "server-only";
import { eq } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { addImport, addUpload } from "./library";

/**
 * Local apps only: a drop folder the app shell writes into ("Share to Jobiza" on
 * Android). PDFs are uploaded; `.link` text files hold a DOI or URL to import.
 * Files are removed once imported, or moved to `failed/` with the reason.
 */
const POLL_MS = 3000;
const MAX_BYTES = 50 * 1024 * 1024;

const g = globalThis as unknown as { __jobizaInbox?: ReturnType<typeof setInterval> };

export function inboxDir() {
  return path.join(env().JOBIZA_DATA_DIR!, "inbox");
}

async function importOne(userId: string, dir: string, name: string) {
  const file = path.join(dir, name);
  const stat = await fs.stat(file);
  // Skip files still being written by the app shell (it renames them into place when done).
  if (!stat.isFile() || name.startsWith(".")) return;
  try {
    if (name.toLowerCase().endsWith(".pdf")) {
      if (stat.size > MAX_BYTES) throw new Error("larger than 50 MB");
      await addUpload(userId, { name, data: await fs.readFile(file) });
    } else if (name.toLowerCase().endsWith(".link")) {
      await addImport(userId, (await fs.readFile(file, "utf8")).trim().slice(0, 2000));
    } else {
      throw new Error("not a PDF or link");
    }
    await fs.rm(file, { force: true });
    console.info(`[inbox] imported ${name}`);
  } catch (err) {
    const failed = path.join(dir, "failed");
    await fs.mkdir(failed, { recursive: true });
    await fs.rename(file, path.join(failed, name)).catch(() => fs.rm(file, { force: true }));
    await fs.writeFile(path.join(failed, `${name}.txt`), String((err as Error).message ?? err)).catch(() => undefined);
    console.error(`[inbox] couldn't import ${name}: ${(err as Error).message}`);
  }
}

export async function startInbox(localEmail: string) {
  if (g.__jobizaInbox) return;
  const dir = inboxDir();
  await fs.mkdir(dir, { recursive: true });
  let busy = false;
  const scan = async () => {
    if (busy) return;
    busy = true;
    try {
      const names = (await fs.readdir(dir)).filter((n) => n !== "failed");
      if (!names.length) return;
      const user = await db().query.user.findFirst({ where: eq(schema.user.email, localEmail) });
      if (!user) return;
      for (const name of names) await importOne(user.id, dir, name);
    } catch (err) {
      console.error("[inbox] scan failed:", (err as Error).message);
    } finally {
      busy = false;
    }
  };
  g.__jobizaInbox = setInterval(() => void scan(), POLL_MS);
  void scan();
}
