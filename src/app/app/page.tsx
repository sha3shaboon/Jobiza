import type { Metadata } from "next";
import Link from "next/link";
import { isDesktop } from "@/lib/env";
import { libraryCounts } from "@/server/library";
import { requireSession } from "@/server/session";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Home" };

export default async function Dashboard() {
  const { user } = await requireSession();
  const [settings, library] = await Promise.all([getSettings(user.id), libraryCounts(user.id)]);
  const steps = [
    // The desktop app has no account to create.
    ...(isDesktop() ? [] : [{ done: true, title: "Create your account", detail: "Done.", href: null }]),
    {
      done: settings.hasApiKey,
      title: "Add your Anthropic API key",
      detail: "Jobiza uses your own key, so you only pay for what you use.",
      href: "/app/settings",
    },
    {
      done: Boolean(settings.model),
      title: "Choose a Claude model",
      detail: "Pick the model that answers your questions. You can change it any time.",
      href: "/app/settings",
    },
    {
      done: library.total > 0,
      title: "Add your first paper",
      detail: "Upload a PDF, or import one by DOI or link.",
      href: "/app/library",
    },
  ];
  const next = steps.find((s) => !s.done && s.href);

  return (
    <div className="mx-auto grid max-w-5xl gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,38rem)_1fr]">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Hello, {user.name.split(" ")[0]}</h1>
        <p className="mt-2 text-lg text-muted">
          {steps.every((s) => s.done) ? "You're all set. Ask your library anything." : `${steps.length === 4 ? "Four" : "Three"} steps and your library is ready to grow.`}
        </p>

        <ol className="mt-10 grid">
          {steps.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[2.25rem_1fr] gap-x-4 border-t border-border py-5">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
                  s.done ? "bg-accent text-accent-fg" : "border border-border text-muted"
                }`}
              >
                {s.done ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
                <span className="sr-only">{s.done ? "Done:" : "To do:"}</span>
              </span>
              <div>
                <h2 className={`text-lg font-medium ${s.done ? "text-muted line-through decoration-1" : ""}`}>{s.title}</h2>
                {!s.done && <p className="mt-1 text-muted">{s.detail}</p>}
                {!s.done && s.href && s === next && (
                  <Link href={s.href} className="btn-primary mt-4">
                    {s.title}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <aside aria-label="Your library" className="lg:border-l lg:border-border lg:pt-20 lg:pl-10">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration with filters */}
        <img src="/illustrations/sprout-pot.svg" alt="" width={220} height={280} className="h-auto w-40" />
        {library.total === 0 ? (
          <>
            <h2 className="mt-4 text-lg font-medium">Your library is empty</h2>
            <p className="mt-1 max-w-xs text-muted">
              Papers you add will show up here, ready to answer questions with the page they came from.
            </p>
          </>
        ) : (
          <>
            <h2 className="mt-4 text-lg font-medium">
              {library.total} {library.total === 1 ? "paper" : "papers"} in your library
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/app/ask" className="btn-primary">
                Ask a question
              </Link>
              <Link href="/app/library" className="btn-secondary">
                Open library
              </Link>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
