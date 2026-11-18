import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { embedDocuments } from "@/lib/ingest/embeddings";
import { lookupDoi, type PaperMetadata } from "@/lib/ingest/metadata";
import { ocrPage } from "@/lib/ingest/ocr";
import { extractPdf, needsOcr } from "@/lib/ingest/pdf";
import { loadFile, looksLikePdf, paperFileKey, saveFile } from "@/lib/ingest/storage";
import { chunkPages, findArxivDoi, findDoi } from "@/lib/ingest/text";
import { fetchSource } from "@/lib/ingest/web";
import { safeFetch, UnsafeUrlError } from "@/lib/net/safe-fetch";
import { getApiKey, getSettings } from "./settings";

type Paper = typeof schema.paper.$inferSelect;
type Page = { pageNumber: number; text: string; method: "text" | "ocr" | "web" };

/** Upper bound on scanned pages read with Claude per paper, to keep costs predictable. */
const MAX_OCR_PAGES = 60;

export class IngestError extends Error {}

async function update(paperId: string, values: Partial<typeof schema.paper.$inferInsert>) {
  await db().update(schema.paper).set(values).where(eq(schema.paper.id, paperId));
}

function applyMetadata(paper: Paper, meta: PaperMetadata | null, { overwriteTitle = false } = {}) {
  if (!meta) return {};
  return {
    title: (overwriteTitle || isPlaceholderTitle(paper) ? meta.title : undefined) ?? undefined,
    authors: paper.authors.length ? undefined : meta.authors,
    year: paper.year ?? meta.year,
    venue: paper.venue ?? meta.venue,
    abstract: paper.abstract ?? meta.abstract,
    url: paper.url ?? meta.landingUrl,
  };
}

function isPlaceholderTitle(paper: Paper) {
  return paper.title === paper.fileName || paper.title === paper.url || paper.title === paper.doi || paper.title.startsWith("Importing");
}

function prune<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

/** Fetch an open-access PDF and keep it, or return null. */
async function fetchPdf(url: string): Promise<Buffer | null> {
  try {
    const res = await safeFetch(url, { accept: "application/pdf" });
    return looksLikePdf(res.body) ? res.body : null;
  } catch {
    return null;
  }
}

/**
 * Turn a queued paper into searchable pages and chunks.
 * Idempotent: re-running replaces earlier pages and chunks.
 */
export async function ingestPaper(paperId: string): Promise<void> {
  const paper = await db().query.paper.findFirst({ where: eq(schema.paper.id, paperId) });
  if (!paper) return;
  try {
    await update(paperId, { status: "processing", statusDetail: "Getting the paper" });
    let current: Paper = paper;
    const patch = async (values: Partial<typeof schema.paper.$inferInsert>) => {
      const clean = prune(values);
      if (Object.keys(clean).length) {
        await update(paperId, clean);
        current = { ...current, ...clean } as Paper;
      }
    };

    let pdf: Buffer | null = null;
    let pages: Page[] = [];
    let downloadNote: string | null = null;

    if (paper.source === "upload") {
      if (!paper.fileKey) throw new IngestError("The uploaded file is missing.");
      pdf = await loadFile(paper.fileKey);
    } else if (paper.source === "doi") {
      const meta = await lookupDoi(paper.doi!);
      // Records added from a literature review already carry title and abstract.
      if (!meta && !paper.abstract) throw new IngestError("Couldn't find that DOI in Crossref or OpenAlex.");
      if (meta) await patch(applyMetadata(current, meta, { overwriteTitle: isPlaceholderTitle(current) }));
      if (meta?.openAccessPdfUrl) pdf = await fetchPdf(meta.openAccessPdfUrl);
      if (!pdf) {
        const abstract = current.abstract ?? meta?.abstract;
        if (!abstract) {
          throw new IngestError("No open-access version was found. Download the PDF from the publisher and upload it.");
        }
        pages = [{ pageNumber: 1, text: abstract, method: "web" }];
        await patch({ metadataOnly: true });
      }
    } else {
      let fetched: Awaited<ReturnType<typeof fetchSource>> | null = null;
      try {
        fetched = await fetchSource(paper.url!);
      } catch (err) {
        // Records from a literature review carry an abstract: index it rather than failing.
        if (err instanceof UnsafeUrlError || !paper.abstract) throw err;
        const why = err instanceof Error ? err.message.replace(/\.$/, "") : "the download failed";
        pages = [{ pageNumber: 1, text: paper.abstract, method: "web" }];
        downloadNote = `Couldn't download the full text (${why}).`;
        await patch({ metadataOnly: true });
      }
      if (!fetched) {
        // abstract fallback already set
      } else if (fetched.kind === "pdf") {
        pdf = fetched.data;
      } else {
        pages = fetched.sections.map((text, i) => ({ pageNumber: i + 1, text, method: "web" as const }));
        await patch({
          title: isPlaceholderTitle(current) ? fetched.title : undefined,
          authors: fetched.byline ? fetched.byline.split(/,\s*/).map((name) => ({ name })) : undefined,
          venue: fetched.siteName,
          url: current.url ?? fetched.url,
          doi: current.doi ?? fetched.doi,
        });
        if (fetched.doi) await patch(applyMetadata(current, await lookupDoi(fetched.doi)));
      }
    }

    let ocrCount = 0;
    let skippedScans = 0;
    if (pdf) {
      if (!looksLikePdf(pdf)) throw new IngestError("That file isn't a readable PDF.");
      const fileKey = current.fileKey ?? paperFileKey(current.workspaceId, paperId);
      if (!current.fileKey) {
        await saveFile(fileKey, pdf);
        await patch({ fileKey });
      }
      await patch({ statusDetail: "Reading the PDF" });
      const extracted = await extractPdf(pdf);
      pages = extracted.pages.map((p) => ({ ...p, method: "text" as const }));
      await patch({ pageCount: extracted.pageCount });

      // Scanned pages: read them with Claude using the owner's key, if they have one.
      const scanned = pages.filter((p) => needsOcr(p.text));
      if (scanned.length) {
        const owner = current.addedBy;
        const apiKey = owner ? await getApiKey(owner) : null;
        const model = owner ? (await getSettings(owner)).model : null;
        if (apiKey && model) {
          for (const page of scanned.slice(0, MAX_OCR_PAGES)) {
            await patch({ statusDetail: `Reading scanned pages (${ocrCount + 1} of ${Math.min(scanned.length, MAX_OCR_PAGES)})` });
            page.text = await ocrPage(pdf, page.pageNumber, { apiKey, model });
            page.method = "ocr";
            ocrCount++;
          }
        }
        skippedScans = scanned.length - ocrCount;
      }

      // Find the DOI on the first pages to fill in title, authors and year.
      const firstPages = pages.slice(0, 2).map((p) => p.text).join("\n");
      const doi = current.doi ?? findDoi(firstPages) ?? findArxivDoi(firstPages);
      const meta = doi ? await lookupDoi(doi) : null;
      await patch({ ...applyMetadata(current, meta), doi: meta ? doi : undefined });
      if (isPlaceholderTitle(current) && extracted.info.title && extracted.info.title.length > 8) {
        await patch({ title: extracted.info.title });
      }
      if (!current.authors.length && extracted.info.author) {
        await patch({ authors: extracted.info.author.split(/;|,| and /).map((name) => ({ name: name.trim() })).filter((a) => a.name) });
      }
    }

    const usable = pages.filter((p) => p.text.trim().length > 0);
    if (!usable.length) {
      throw new IngestError(
        skippedScans
          ? "This PDF is scanned. Add your Anthropic API key in Settings so Jobiza can read it, then retry."
          : "No readable text was found in this source.",
      );
    }

    await patch({ statusDetail: "Indexing for search" });
    const chunks = chunkPages(usable);
    const vectors = await embedDocuments(chunks.map((c) => c.text));

    await db().transaction(async (tx) => {
      await tx.delete(schema.chunk).where(eq(schema.chunk.paperId, paperId));
      await tx.delete(schema.paperPage).where(eq(schema.paperPage.paperId, paperId));
      await tx.insert(schema.paperPage).values(pages.map((p) => ({ paperId, ...p })));
      for (let i = 0; i < chunks.length; i += 200) {
        await tx.insert(schema.chunk).values(
          chunks.slice(i, i + 200).map((c, j) => ({
            id: randomUUID(),
            paperId,
            workspaceId: current.workspaceId,
            pageNumber: c.pageNumber,
            chunkIndex: c.chunkIndex,
            text: c.text,
            embedding: vectors[i + j],
          })),
        );
      }
      const notes = [
        ocrCount ? `${ocrCount} scanned ${ocrCount === 1 ? "page was" : "pages were"} read with Claude.` : null,
        skippedScans ? `${skippedScans} scanned ${skippedScans === 1 ? "page" : "pages"} couldn't be read.` : null,
        current.metadataOnly
          ? `${downloadNote ? `${downloadNote} ` : ""}Only the abstract is available. Upload the PDF to search the full text.`
          : null,
      ].filter(Boolean);
      await tx
        .update(schema.paper)
        .set({ status: "ready", statusDetail: notes.join(" ") || null, pageCount: current.pageCount ?? pages.length })
        .where(eq(schema.paper.id, paperId));
    });
  } catch (err) {
    const expected = err instanceof IngestError || err instanceof UnsafeUrlError;
    const message =
      expected || (err instanceof Error && /import|PDF|link|address|site|redirect|large/i.test(err.message))
        ? (err as Error).message
        : "Something went wrong while processing this paper. Try again.";
    if (!expected) console.error(`[ingest] ${paperId} failed:`, err);
    await update(paperId, { status: "failed", statusDetail: message });
    if (!expected) throw err; // let the queue retry unexpected failures
  }
}
