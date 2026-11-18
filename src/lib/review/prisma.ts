import type { ReviewCounts } from "@/db/schema";

export type PrismaRecord = {
  screening: "pending" | "included" | "excluded";
  exclusionReason: string | null;
  fullText: "not_requested" | "pending" | "retrieved" | "abstract_only" | "failed";
};

export type PrismaFlow = {
  identified: { source: string; count: number }[];
  identifiedTotal: number;
  duplicatesRemoved: number;
  screened: number;
  awaitingScreening: number;
  excludedAtScreening: number;
  exclusionReasons: { reason: string; count: number }[];
  soughtForRetrieval: number;
  notRetrieved: number;
  abstractOnly: number;
  /** Studies whose text (full or abstract) feeds the synthesis. */
  includedInReview: number;
};

/** PRISMA 2020 flow counts from a review's search counts and record decisions. */
export function prismaFlow(counts: ReviewCounts | null, records: PrismaRecord[]): PrismaFlow {
  const identified = Object.entries(counts?.identified ?? {})
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
  const reasons = new Map<string, number>();
  for (const r of records) {
    if (r.screening !== "excluded") continue;
    const reason = r.exclusionReason?.trim() || "No reason given";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const included = records.filter((r) => r.screening === "included");
  const sought = included.filter((r) => r.fullText !== "not_requested");
  return {
    identified,
    identifiedTotal: identified.reduce((n, x) => n + x.count, 0),
    duplicatesRemoved: counts?.duplicates ?? 0,
    screened: records.filter((r) => r.screening !== "pending").length,
    awaitingScreening: records.filter((r) => r.screening === "pending").length,
    excludedAtScreening: records.filter((r) => r.screening === "excluded").length,
    exclusionReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    soughtForRetrieval: sought.length,
    notRetrieved: sought.filter((r) => r.fullText === "failed").length,
    abstractOnly: sought.filter((r) => r.fullText === "abstract_only").length,
    includedInReview: sought.filter((r) => r.fullText === "retrieved" || r.fullText === "abstract_only").length,
  };
}

/** Records as CSV (screening log export). */
export function toCsv(rows: Record<string, string | number | null | undefined>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Neutralise spreadsheet formulas and quote everything that needs it.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => cell(r[h])).join(","))].join("\r\n") + "\r\n";
}
