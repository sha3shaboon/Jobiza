"use client";

import Link from "next/link";
import { formatAuthors } from "@/lib/paper-format";
import type { ReviewDetail } from "@/server/reviews";
import type { Step } from "./review-view";

/** The comparison table: one row per included study, one column per question. */
export function StudiesTable({ data, running, onRun, onRead }: { data: ReviewDetail; running: boolean; onRun: (s: Step) => void; onRead: (recordId: string) => void }) {
  const { review, records } = data;
  const order = { retrieved: 0, abstract_only: 1, pending: 2, not_requested: 3, failed: 4 } as const;
  const included = records.filter((r) => r.screening === "included").sort((a, b) => order[a.fullText] - order[b.fullText]);
  const readable = included.filter((r) => r.fullText === "retrieved" || r.fullText === "abstract_only");
  const notFetched = included.filter((r) => r.fullText === "not_requested" || r.fullText === "failed").length;
  const columns = review.matrixColumns;
  const filled = readable.some((r) => r.matrix);

  return (
    <div>
      {review.mode === "screening" && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {notFetched > 0 && (
            <button className="btn-secondary" disabled={running} onClick={() => onRun("retrieve")}>
              Get {notFetched} more {notFetched === 1 ? "study" : "studies"}
            </button>
          )}
          <button className="btn-primary" disabled={running || !readable.length} onClick={() => onRun("extract")}>
            {filled ? "Fill the table again" : "Fill the table with Claude"}
          </button>
          <p className="text-sm text-muted">Values come from each study&apos;s text, with the page they came from.</p>
        </div>
      )}

      <div className="overflow-x-auto rounded-[14px] border border-border">
        <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="w-[22rem] px-4 py-3 font-medium">
                Study
              </th>
              {columns.map((c) => (
                <th key={c} scope="col" className="px-4 py-3 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {included.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <th scope="row" className="px-4 py-3 font-normal">
                  <button className="text-left font-medium hover:underline" onClick={() => onRead(r.id)}>
                    {r.title}
                  </button>
                  <span className="mt-1 block text-muted">{[formatAuthors(r.authors, 2), r.year].filter(Boolean).join(", ")}</span>
                  {r.fullText !== "retrieved" && (
                    <span className="mt-1 block text-xs text-muted">
                      {r.fullText === "abstract_only" ? "Abstract only" : r.fullText === "failed" ? "Couldn't be read" : r.fullText === "pending" ? "Reading…" : "Not read yet"}
                    </span>
                  )}
                </th>
                {columns.map((c) => {
                  const cell = r.matrix?.[c];
                  return (
                    <td key={c} className="px-4 py-3 leading-relaxed">
                      {cell ? (
                        <>
                          <span className={cell.value === "Not reported" ? "text-muted" : ""}>{cell.value}</span>
                          {cell.page && r.paperId && (
                            <Link href={`/app/library/${r.paperId}?page=${cell.page}`} className="ml-1 text-xs whitespace-nowrap text-muted underline underline-offset-2">
                              p. {cell.page}
                            </Link>
                          )}
                        </>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
