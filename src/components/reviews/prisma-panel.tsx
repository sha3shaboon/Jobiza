"use client";

import type { ReviewDetail } from "@/server/reviews";

const SOURCE_NAMES: Record<string, string> = { openalex: "OpenAlex", semantic_scholar: "Semantic Scholar", arxiv: "arXiv", pubmed: "PubMed" };
const fmt = new Intl.NumberFormat();
const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function Box({ title, n, children }: { title: string; n: number; children?: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-border bg-surface px-4 py-3">
      <p className="text-sm text-muted">{title}</p>
      <p className="text-2xl font-semibold tabular-nums">{fmt.format(n)}</p>
      {children && <div className="mt-2 text-sm">{children}</div>}
    </div>
  );
}

function Side({ title, n, children }: { title: string; n: number; children?: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-border px-4 py-3 text-sm">
      <p className="text-muted">
        {title}: <span className="font-semibold text-text tabular-nums">{fmt.format(n)}</span>
      </p>
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

/** PRISMA 2020 flow (identification, screening, retrieval, inclusion) plus the activity log. */
export function PrismaPanel({ data }: { data: ReviewDetail }) {
  const p = data.prisma;
  const unique = data.records.length;
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="prisma-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="prisma-title" className="text-xl font-semibold">
            PRISMA flow
          </h2>
          {unique > 0 && (
            <a href={`/api/v1/reviews/${data.review.id}/export`} className="btn-secondary min-h-10 px-4 text-sm">
              Download screening log (CSV)
            </a>
          )}
        </div>
        {unique === 0 ? (
          <p className="mt-4 text-muted">The flow fills in once the search runs.</p>
        ) : (
          <ol className="mt-6 grid gap-3">
            <li className="grid gap-3 sm:grid-cols-[1fr_16rem]">
              <Box title="Records identified" n={p.identifiedTotal}>
                {p.identified.map((s) => (
                  <span key={s.source} className="mr-3 inline-block text-muted">
                    {SOURCE_NAMES[s.source] ?? s.source}: <span className="tabular-nums">{s.count}</span>
                  </span>
                ))}
              </Box>
              <Side title="Duplicates removed" n={p.duplicatesRemoved} />
            </li>
            <li className="grid gap-3 sm:grid-cols-[1fr_16rem]">
              <Box title="Records screened (title and abstract)" n={p.screened}>
                {p.awaitingScreening > 0 && <span className="text-muted">{p.awaitingScreening} still to screen</span>}
              </Box>
              <Side title="Excluded" n={p.excludedAtScreening}>
                <ul className="grid gap-0.5 text-muted">
                  {p.exclusionReasons.slice(0, 6).map((r) => (
                    <li key={r.reason}>
                      {r.reason} (<span className="tabular-nums">{r.count}</span>)
                    </li>
                  ))}
                  {p.exclusionReasons.length > 6 && <li>and {p.exclusionReasons.length - 6} other reasons</li>}
                </ul>
              </Side>
            </li>
            <li className="grid gap-3 sm:grid-cols-[1fr_16rem]">
              <Box title="Reports sought for retrieval" n={p.soughtForRetrieval} />
              <Side title="Not retrieved" n={p.notRetrieved}>
                {p.abstractOnly > 0 && <span className="text-muted">{p.abstractOnly} assessed from the abstract only</span>}
              </Side>
            </li>
            <li>
              <Box title="Studies included in the review" n={p.includedInReview} />
            </li>
          </ol>
        )}
      </section>

      <section aria-labelledby="log-title">
        <h2 id="log-title" className="text-xl font-semibold">
          Activity
        </h2>
        <ol className="mt-4 grid gap-3 border-l border-border pl-4">
          {data.events.map((e) => (
            <li key={e.id} className="text-sm">
              <p className={e.kind === "error" ? "text-danger" : ""}>{e.message}</p>
              <p className="text-xs text-muted">{time.format(new Date(e.at))}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
