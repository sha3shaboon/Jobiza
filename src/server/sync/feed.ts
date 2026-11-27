import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { deleteFile } from "@/lib/ingest/storage";

/**
 * What devices exchange: rows of the synced tables in change-number order,
 * plus tombstones for deletes. Newest edit wins (by updated_at). Rows are
 * moved as JSON and written back with jsonb_populate_record, so the same code
 * works for every table and for both Postgres and the embedded database.
 */

type TableSpec = {
  table: string;
  key: string;
  /** Column compared to decide which edit is newer; null for append-only tables. */
  newer: "updated_at" | null;
  /** Parents that must exist first: column → table. */
  parents?: Record<string, string>;
  /** Rows not to send yet (work in progress on the sending device). */
  ready?: SQL;
};

// Order matters when applying: parents before children.
export const SYNCED: TableSpec[] = [
  { table: "user_settings", key: "user_id", newer: "updated_at" },
  // A paper still being processed is sent once it's done (its change number moves on then).
  { table: "paper", key: "id", newer: "updated_at", ready: sql`status IN ('ready', 'failed')` },
  { table: "conversation", key: "id", newer: "updated_at" },
  { table: "message", key: "id", newer: "updated_at", parents: { conversation_id: "conversation" } },
  // Same for a review step that's still running.
  { table: "review", key: "id", newer: "updated_at", ready: sql`status NOT IN ('searching', 'screening', 'retrieving', 'extracting', 'synthesizing')` },
  { table: "review_record", key: "id", newer: "updated_at", parents: { review_id: "review", paper_id: "paper" } },
  { table: "review_event", key: "id", newer: null, parents: { review_id: "review" } },
  { table: "document", key: "id", newer: "updated_at" },
];
const BY_TABLE = new Map(SYNCED.map((t) => [t.table, t]));

/** Columns that only make sense on the device that wrote them. */
const LOCAL_ONLY: Record<string, string[]> = {
  user_settings: ["anthropic_key_ciphertext", "anthropic_key_last4", "anthropic_key_verified_at"],
};

export type Row = Record<string, unknown>;
export type Change =
  | { kind: "row"; table: string; seq: number; row: Row; children?: { pages: Row[]; chunks: Row[]; hasFile: boolean } }
  | { kind: "delete"; table: string; seq: number; id: string; deletedAt: string };
export type ChangeBatch = { changes: Change[]; cursor: number; more: boolean };

const rows = async <T = Row>(q: SQL) => (await db().execute(q)).rows as T[];

/* ───────────── Sending ───────────── */

const BATCH_ROWS = 200;
const BATCH_BYTES = 6_000_000;

/** Changes after `since`, oldest first, in batches small enough to send at once. */
export async function changesSince(since: number): Promise<ChangeBatch> {
  const found: Change[] = [];
  let more = false;
  for (const t of SYNCED) {
    const strip = [...(LOCAL_ONLY[t.table] ?? []), "sync_seq"].map((c) => sql` - ${c}::text`);
    const got = await rows<{ row: Row; seq: string }>(sql`
      SELECT to_jsonb(t) ${sql.join(strip, sql``)} AS row, t.sync_seq AS seq
      FROM ${sql.identifier(t.table)} t
      WHERE t.sync_seq > ${since} ${t.ready ? sql`AND ${t.ready}` : sql``}
      ORDER BY t.sync_seq LIMIT ${BATCH_ROWS + 1}`);
    if (got.length > BATCH_ROWS) more = true;
    for (const g of got.slice(0, BATCH_ROWS)) found.push({ kind: "row", table: t.table, seq: Number(g.seq), row: g.row });
  }
  const dead = await rows<{ table_name: string; row_id: string; deleted_at: string; seq: string }>(sql`
    SELECT table_name, row_id, deleted_at, sync_seq AS seq FROM sync_tombstone
    WHERE sync_seq > ${since} ORDER BY sync_seq LIMIT ${BATCH_ROWS + 1}`);
  if (dead.length > BATCH_ROWS) more = true;
  for (const d of dead.slice(0, BATCH_ROWS)) {
    if (BY_TABLE.has(d.table_name)) found.push({ kind: "delete", table: d.table_name, seq: Number(d.seq), id: d.row_id, deletedAt: new Date(d.deleted_at).toISOString() });
  }

  // Merge by change number and keep a prefix, so the cursor never skips anything.
  found.sort((a, b) => a.seq - b.seq);
  const out: Change[] = [];
  let bytes = 0;
  for (const c of found) {
    if (out.length >= BATCH_ROWS || (out.length && bytes > BATCH_BYTES)) {
      more = true;
      break;
    }
    if (c.kind === "row" && c.table === "paper") {
      // A paper travels with its pages and search chunks (text and vectors), so the
      // other device doesn't redo the work. The PDF itself is fetched separately.
      const id = String(c.row.id);
      const [pages, chunks] = await Promise.all([
        rows<{ row: Row }>(sql`SELECT to_jsonb(p) AS row FROM paper_page p WHERE p.paper_id = ${id}`),
        rows<{ row: Row }>(sql`SELECT to_jsonb(c) - 'tsv' AS row FROM chunk c WHERE c.paper_id = ${id}`),
      ]);
      c.children = { pages: pages.map((p) => p.row), chunks: chunks.map((x) => x.row), hasFile: Boolean(c.row.file_key) };
    }
    bytes += JSON.stringify(c).length;
    out.push(c);
  }
  const cursor = out.length ? out[out.length - 1].seq : since;
  return { changes: out, cursor, more };
}

/* ───────────── Receiving ───────────── */

type Local = { userId: string; workspaceId: string };

const columnCache = new Map<string, string[]>();
async function columns(table: string) {
  if (!columnCache.has(table)) {
    const cols = await rows<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND is_generated = 'NEVER' AND column_name <> 'sync_seq'
      ORDER BY ordinal_position`);
    columnCache.set(table, cols.map((c) => c.column_name));
  }
  return columnCache.get(table)!;
}

/** The sender's account and workspace ids become this device's own. */
function localize(table: string, row: Row, local: Local): Row {
  const r = { ...row };
  if ("workspace_id" in r) r.workspace_id = local.workspaceId;
  if ("user_id" in r) r.user_id = local.userId;
  if ("added_by" in r && r.added_by) r.added_by = local.userId;
  if (table === "paper" && r.file_key) r.file_key = `${local.workspaceId}/${String(r.id)}.pdf`;
  for (const c of LOCAL_ONLY[table] ?? []) delete r[c];
  return r;
}

/** Insert the row, or replace the local copy only if this edit is newer. True if it was written. */
async function upsert(table: string, row: Row): Promise<boolean> {
  const spec = BY_TABLE.get(table)!;
  const cols = (await columns(table)).filter((c) => c in row);
  const ident = (c: string) => sql.identifier(c);
  const list = sql.join(cols.map(ident), sql`, `);
  const updates = cols.filter((c) => c !== spec.key);
  const conflict =
    spec.newer && updates.length
      ? sql`DO UPDATE SET ${sql.join(
          updates.map((c) => sql`${ident(c)} = EXCLUDED.${ident(c)}`),
          sql`, `,
        )} WHERE ${sql.identifier(table)}.${ident(spec.newer)} < EXCLUDED.${ident(spec.newer)}`
      : sql`DO NOTHING`;
  const written = await rows(sql`
    INSERT INTO ${sql.identifier(table)} (${list})
    SELECT ${list} FROM jsonb_populate_record(NULL::${sql.identifier(table)}, ${JSON.stringify(row)}::jsonb)
    ON CONFLICT (${ident(spec.key)}) ${conflict}
    RETURNING 1 AS ok`);
  return written.length > 0;
}

async function exists(table: string, id: unknown) {
  if (id == null) return true;
  const r = await rows(sql`SELECT 1 FROM ${sql.identifier(table)} WHERE id = ${String(id)} LIMIT 1`);
  return r.length > 0;
}

async function missingParent(spec: TableSpec, row: Row) {
  for (const [col, parent] of Object.entries(spec.parents ?? {})) if (!(await exists(parent, row[col]))) return true;
  return false;
}

/** Apply one row (and a paper's pages and chunks). False if a parent is missing. */
async function applyRow(table: string, row: Row, children: Extract<Change, { kind: "row" }>["children"], local: Local, wantFiles: Set<string>) {
  const spec = BY_TABLE.get(table)!;
  if (await missingParent(spec, row)) return false;
  const r = localize(table, row, local);
  if (table === "user_settings") {
    // Only preferences sync: the API key stays encrypted on the device that saved it.
    await db().execute(sql`
      INSERT INTO user_settings (user_id, model, citation_style, updated_at)
      VALUES (${local.userId}, ${r.model as string | null}, ${String(r.citation_style ?? "apa")}, ${String(r.updated_at)}::timestamptz)
      ON CONFLICT (user_id) DO UPDATE SET model = EXCLUDED.model, citation_style = EXCLUDED.citation_style, updated_at = EXCLUDED.updated_at
      WHERE user_settings.updated_at < EXCLUDED.updated_at`);
    return true;
  }
  const written = await upsert(table, r);
  if (written && table === "paper" && children) {
    const id = String(r.id);
    await db().execute(sql`DELETE FROM paper_page WHERE paper_id = ${id}`);
    await db().execute(sql`DELETE FROM chunk WHERE paper_id = ${id}`);
    for (const p of children.pages) {
      await db().execute(sql`INSERT INTO paper_page SELECT * FROM jsonb_populate_record(NULL::paper_page, ${JSON.stringify(p)}::jsonb)`);
    }
    const chunkCols = await (async () => {
      const c = await rows<{ column_name: string }>(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'chunk' AND is_generated = 'NEVER' ORDER BY ordinal_position`);
      return sql.join(c.map((x) => sql.identifier(x.column_name)), sql`, `);
    })();
    for (const c of children.chunks) {
      const ch = { ...c, workspace_id: local.workspaceId };
      await db().execute(sql`INSERT INTO chunk (${chunkCols}) SELECT ${chunkCols} FROM jsonb_populate_record(NULL::chunk, ${JSON.stringify(ch)}::jsonb)`);
    }
    if (children.hasFile) wantFiles.add(id);
  }
  return true;
}

async function applyDelete(table: string, id: string, deletedAt: string) {
  const spec = BY_TABLE.get(table)!;
  if (spec.key !== "id") return;
  const stamp = spec.newer ? sql`${sql.identifier(spec.newer)}` : sql`created_at`;
  // An edit made after the delete wins: the row stays.
  const gone = await rows<{ file_key: string | null }>(
    sql`DELETE FROM ${sql.identifier(table)} WHERE id = ${id} AND ${stamp} <= ${deletedAt}::timestamptz RETURNING ${table === "paper" ? sql`file_key` : sql`NULL AS file_key`}`,
  );
  for (const g of gone) if (g.file_key) await deleteFile(g.file_key).catch(() => undefined);
}

/** Apply a batch from a peer. Returns papers whose PDF should be fetched. */
export async function applyChanges(batch: ChangeBatch, local: Local): Promise<{ applied: number; deferred: number; files: string[] }> {
  const wantFiles = new Set<string>();
  let applied = 0;
  let deferred = 0;
  const order = new Map(SYNCED.map((t, i) => [t.table, i]));
  // Parents first within the batch; deletes in their original order after rows.
  const rowsFirst = [...batch.changes].sort((a, b) => (a.kind === b.kind ? (order.get(a.table)! - order.get(b.table)!) || a.seq - b.seq : a.kind === "row" ? -1 : 1));
  for (const c of rowsFirst) {
    if (c.kind === "delete") {
      await applyDelete(c.table, c.id, c.deletedAt);
      await db().execute(sql`DELETE FROM sync_pending WHERE table_name = ${c.table} AND row_id = ${c.id}`);
      applied++;
      continue;
    }
    if (await applyRow(c.table, c.row, c.children, local, wantFiles)) {
      applied++;
    } else {
      deferred++;
      await db().execute(sql`
        INSERT INTO sync_pending (table_name, row_id, row, children) VALUES (${c.table}, ${String(c.row[BY_TABLE.get(c.table)!.key])}, ${JSON.stringify(c.row)}::jsonb, ${c.children ? JSON.stringify(c.children) : null}::jsonb)
        ON CONFLICT (table_name, row_id) DO UPDATE SET row = EXCLUDED.row, children = EXCLUDED.children`);
    }
  }
  // Earlier rows that were waiting for a parent may fit now.
  const waiting = await rows<{ table_name: string; row_id: string; row: Row; children: Extract<Change, { kind: "row" }>["children"] | null; created_at: string }>(
    sql`SELECT * FROM sync_pending ORDER BY created_at`,
  );
  for (const w of waiting.sort((a, b) => order.get(a.table_name)! - order.get(b.table_name)!)) {
    if (await applyRow(w.table_name, w.row, w.children ?? undefined, local, wantFiles)) {
      await db().execute(sql`DELETE FROM sync_pending WHERE table_name = ${w.table_name} AND row_id = ${w.row_id}`);
      applied++;
    } else if (Date.now() - new Date(w.created_at).getTime() > 14 * 86_400_000) {
      // The parent was deleted before it ever arrived.
      await db().execute(sql`DELETE FROM sync_pending WHERE table_name = ${w.table_name} AND row_id = ${w.row_id}`);
    }
  }
  return { applied, deferred, files: [...wantFiles] };
}
