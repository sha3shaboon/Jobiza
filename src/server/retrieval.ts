import "server-only";
import { and, cosineDistance, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { embedQuery } from "@/lib/ingest/embeddings";
import { reciprocalRankFusion } from "@/lib/ingest/text";

export type RetrievedChunk = {
  chunkId: string;
  paperId: string;
  pageNumber: number;
  text: string;
  paperTitle: string;
  authors: string[];
  year: number | null;
  /** "page" for PDFs, "section" for web articles. */
  locator: "page" | "section";
  score: number;
};

/**
 * Hybrid search over a workspace: pgvector cosine similarity and Postgres
 * full-text search, merged with reciprocal rank fusion. Only ready papers;
 * optionally limited to `paperIds`.
 */
export async function hybridSearch(
  workspaceId: string,
  query: string,
  { paperIds, limit = 10, perPaperLimit = 4, candidates = 40 }: { paperIds?: string[]; limit?: number; perPaperLimit?: number; candidates?: number } = {},
): Promise<RetrievedChunk[]> {
  const d = db();
  const c = schema.chunk;
  const scope = and(
    eq(c.workspaceId, workspaceId),
    paperIds?.length ? inArray(c.paperId, paperIds) : undefined,
    sql`exists (select 1 from ${schema.paper} p where p.id = ${c.paperId} and p.status = 'ready')`,
  );

  const vector = await embedQuery(query);
  const tsQuery = sql`websearch_to_tsquery('english', ${query})`;
  const [semantic, keyword] = await Promise.all([
    d.select({ id: c.id }).from(c).where(scope).orderBy(cosineDistance(c.embedding, vector)).limit(candidates),
    d
      .select({ id: c.id })
      .from(c)
      .where(and(scope, sql`${c.tsv} @@ ${tsQuery}`))
      .orderBy(desc(sql`ts_rank_cd(${c.tsv}, ${tsQuery})`))
      .limit(candidates),
  ]);

  const fused = reciprocalRankFusion([semantic.map((r) => r.id), keyword.map((r) => r.id)]);
  if (!fused.length) return [];

  const rows = await d
    .select({
      chunkId: c.id,
      paperId: c.paperId,
      pageNumber: c.pageNumber,
      text: c.text,
      paperTitle: schema.paper.title,
      authors: schema.paper.authors,
      year: schema.paper.year,
      hasFile: sql<boolean>`${schema.paper.fileKey} is not null`,
    })
    .from(c)
    .innerJoin(schema.paper, eq(schema.paper.id, c.paperId))
    .where(inArray(c.id, fused.slice(0, candidates).map((f) => f.id)));
  const byId = new Map(rows.map((r) => [r.chunkId, r]));

  // Keep the fused order, but don't let one paper crowd out the rest.
  const perPaper = new Map<string, number>();
  const out: RetrievedChunk[] = [];
  for (const { id, score } of fused) {
    const row = byId.get(id);
    if (!row) continue;
    const n = perPaper.get(row.paperId) ?? 0;
    if (!paperIds?.length || paperIds.length > 1) {
      if (n >= perPaperLimit) continue;
    }
    perPaper.set(row.paperId, n + 1);
    out.push({
      chunkId: row.chunkId,
      paperId: row.paperId,
      pageNumber: row.pageNumber,
      text: row.text,
      paperTitle: row.paperTitle,
      authors: row.authors.map((a) => a.name),
      year: row.year,
      locator: row.hasFile ? "page" : "section",
      score,
    });
    if (out.length >= limit) break;
  }
  return out;
}
