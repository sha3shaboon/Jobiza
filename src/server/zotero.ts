import "server-only";
import { fromCsl, type ImportedReference } from "./citations";
import { LibraryError } from "./library";

const MAX_ITEMS = 500;

/**
 * Read a Zotero library (or one collection) through the Zotero Web API.
 * The key is used for this request only and never stored.
 */
export async function fetchZoteroLibrary(opts: {
  libraryType: "user" | "group";
  libraryId: string;
  apiKey: string;
  collectionKey?: string;
}): Promise<ImportedReference[]> {
  if (!/^\d{1,12}$/.test(opts.libraryId)) throw new LibraryError("The Zotero user or group ID is the number shown on zotero.org/settings/keys.");
  if (opts.collectionKey && !/^[A-Z0-9]{8}$/.test(opts.collectionKey)) throw new LibraryError("That collection key doesn't look right.");
  const base = `https://api.zotero.org/${opts.libraryType}s/${opts.libraryId}${opts.collectionKey ? `/collections/${opts.collectionKey}` : ""}/items/top`;
  const items: unknown[] = [];
  for (let start = 0; start < MAX_ITEMS; start += 100) {
    const url = `${base}?format=csljson&limit=100&start=${start}`;
    const res = await fetch(url, {
      headers: { "Zotero-API-Key": opts.apiKey, "Zotero-API-Version": "3" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 403) throw new LibraryError("Zotero refused that key. Check it has read access to this library.");
    if (res.status === 404) throw new LibraryError("Zotero couldn't find that library or collection.");
    if (!res.ok) throw new LibraryError(`Zotero returned an error (${res.status}). Try again.`);
    const body = (await res.json()) as { items?: unknown[] };
    const page = body.items ?? [];
    items.push(...page);
    const total = Number(res.headers.get("total-results") ?? 0);
    if (page.length < 100 || items.length >= total) break;
  }
  return fromCsl(items as Parameters<typeof fromCsl>[0]);
}
