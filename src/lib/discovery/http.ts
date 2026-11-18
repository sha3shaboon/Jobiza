import { SOURCE_LABELS, SourceUnavailableError, type DiscoverySource } from "./types";

const TIMEOUT = 20_000;

/**
 * GET with one polite retry on a short Retry-After. Rate limits and errors
 * become SourceUnavailableError so a review can carry on with other sources.
 */
export async function getText(source: DiscoverySource, url: string, headers: Record<string, string> = {}): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "user-agent": "Jobiza/0.1 (literature review; https://github.com/sha3shaboon/jobiza)", ...headers },
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch {
      throw new SourceUnavailableError(source, "error", `${SOURCE_LABELS[source]} didn't respond.`);
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after"));
      if (attempt === 0 && wait > 0 && wait <= 5) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw new SourceUnavailableError(source, "rate_limited", `${SOURCE_LABELS[source]} is rate-limiting requests right now.`);
    }
    if (!res.ok) throw new SourceUnavailableError(source, "error", `${SOURCE_LABELS[source]} returned an error (${res.status}).`);
    return res.text();
  }
  throw new SourceUnavailableError(source, "rate_limited", `${SOURCE_LABELS[source]} is rate-limiting requests right now.`);
}

export async function getJson<T>(source: DiscoverySource, url: string, headers: Record<string, string> = {}): Promise<T> {
  const text = await getText(source, url, headers);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SourceUnavailableError(source, "error", `${SOURCE_LABELS[source]} sent an unreadable response.`);
  }
}

export function cleanText(s: string | null | undefined): string | undefined {
  const t = s?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t || undefined;
}
