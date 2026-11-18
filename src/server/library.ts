import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { deleteFile, looksLikePdf, paperFileKey, saveFile } from "@/lib/ingest/storage";
import { normalizeDoi } from "@/lib/ingest/text";
import { assertPublicUrl, UnsafeUrlError } from "@/lib/net/safe-fetch";
import { enqueueIngest } from "./queue";
import { getPersonalWorkspace } from "./workspaces";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export class LibraryError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Workspace the user acts in. Phase 2: their personal workspace. */
export async function workspaceFor(userId: string) {
  const ws = await getPersonalWorkspace(userId);
  if (!ws) throw new LibraryError("Workspace not found.", 404);
  return ws;
}

export type PaperSummary = {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  source: "upload" | "doi" | "url";
  status: "queued" | "processing" | "ready" | "failed";
  statusDetail: string | null;
  pageCount: number | null;
  hasFile: boolean;
  metadataOnly: boolean;
  createdAt: string;
};

type PaperRow = typeof schema.paper.$inferSelect;

export function toSummary(p: PaperRow): PaperSummary {
  return {
    id: p.id,
    title: p.title,
    authors: p.authors.map((a) => a.name),
    year: p.year,
    venue: p.venue,
    doi: p.doi,
    url: p.url,
    source: p.source,
    status: p.status,
    statusDetail: p.statusDetail,
    pageCount: p.pageCount,
    hasFile: Boolean(p.fileKey),
    metadataOnly: p.metadataOnly,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listPapers(userId: string): Promise<PaperSummary[]> {
  const ws = await workspaceFor(userId);
  const rows = await db().query.paper.findMany({
    where: eq(schema.paper.workspaceId, ws.id),
    orderBy: [desc(schema.paper.createdAt)],
  });
  return rows.map(toSummary);
}

/** Loads a paper only if it belongs to the user's workspace. */
export async function getOwnedPaper(userId: string, paperId: string): Promise<PaperRow> {
  const ws = await workspaceFor(userId);
  const row = await db().query.paper.findFirst({
    where: and(eq(schema.paper.id, paperId), eq(schema.paper.workspaceId, ws.id)),
  });
  if (!row) throw new LibraryError("Paper not found.", 404);
  return row;
}

export async function getPaperPage(userId: string, paperId: string, pageNumber: number) {
  await getOwnedPaper(userId, paperId);
  return db().query.paperPage.findFirst({
    where: and(eq(schema.paperPage.paperId, paperId), eq(schema.paperPage.pageNumber, pageNumber)),
  });
}

export async function addUpload(userId: string, file: { name: string; data: Buffer }) {
  if (file.data.byteLength > MAX_UPLOAD_BYTES) throw new LibraryError("That file is larger than 50 MB.", 413);
  if (!looksLikePdf(file.data)) throw new LibraryError("Only PDF files can be uploaded.");
  const ws = await workspaceFor(userId);
  const id = randomUUID();
  const fileKey = paperFileKey(ws.id, id);
  await saveFile(fileKey, file.data);
  const name = file.name.replace(/\.pdf$/i, "").slice(0, 300) || "Untitled paper";
  const [row] = await db()
    .insert(schema.paper)
    .values({ id, workspaceId: ws.id, addedBy: userId, source: "upload", title: name, fileName: name, fileKey })
    .returning();
  await enqueueIngest(id);
  return toSummary(row);
}

/** Import by DOI ("10.x/y", "doi:…", doi.org link) or by web link. */
export async function addImport(userId: string, input: string) {
  const ws = await workspaceFor(userId);
  const trimmed = input.trim();
  const doi = normalizeDoi(trimmed);
  const id = randomUUID();

  if (doi) {
    const existing = await db().query.paper.findFirst({
      where: and(eq(schema.paper.workspaceId, ws.id), eq(schema.paper.doi, doi)),
    });
    if (existing) throw new LibraryError("That paper is already in your library.", 409);
    const [row] = await db()
      .insert(schema.paper)
      .values({ id, workspaceId: ws.id, addedBy: userId, source: "doi", title: doi, doi })
      .returning();
    await enqueueIngest(id);
    return toSummary(row);
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new LibraryError("Enter a DOI (like 10.1038/nature14539) or a link to a paper or article.");
  }
  if (!url.hostname.includes(".") && !/^\[?[\d:.]+\]?$/.test(url.hostname)) {
    throw new LibraryError("Enter a DOI (like 10.1038/nature14539) or a link to a paper or article.");
  }
  try {
    await assertPublicUrl(url.toString());
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new LibraryError(err.message);
    throw new LibraryError("Couldn't reach that address. Check the link and try again.");
  }
  const [row] = await db()
    .insert(schema.paper)
    .values({ id, workspaceId: ws.id, addedBy: userId, source: "url", title: url.toString(), url: url.toString() })
    .returning();
  await enqueueIngest(id);
  return toSummary(row);
}

export async function retryPaper(userId: string, paperId: string) {
  const paper = await getOwnedPaper(userId, paperId);
  if (paper.status === "processing" || paper.status === "queued") return toSummary(paper);
  const [row] = await db()
    .update(schema.paper)
    .set({ status: "queued", statusDetail: null })
    .where(eq(schema.paper.id, paperId))
    .returning();
  await enqueueIngest(paperId);
  return toSummary(row);
}

export async function deletePaper(userId: string, paperId: string) {
  const paper = await getOwnedPaper(userId, paperId);
  await db().delete(schema.paper).where(eq(schema.paper.id, paperId));
  if (paper.fileKey) await deleteFile(paper.fileKey).catch(() => undefined);
}

export async function readyPaperIds(workspaceId: string, onlyIds?: string[]) {
  const rows = await db()
    .select({ id: schema.paper.id })
    .from(schema.paper)
    .where(
      and(
        eq(schema.paper.workspaceId, workspaceId),
        eq(schema.paper.status, "ready"),
        onlyIds?.length ? inArray(schema.paper.id, onlyIds) : undefined,
      ),
    )
    .orderBy(asc(schema.paper.createdAt));
  return rows.map((r) => r.id);
}

export async function libraryCounts(userId: string) {
  const ws = await workspaceFor(userId);
  const [row] = await db()
    .select({ total: count() })
    .from(schema.paper)
    .where(eq(schema.paper.workspaceId, ws.id));
  return { total: row?.total ?? 0 };
}
