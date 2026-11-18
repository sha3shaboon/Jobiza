import Link from "next/link";
import { Logo } from "@/components/logo";

const pillars = [
  {
    title: "Chat with your library",
    body: "Upload PDFs or import by DOI. Ask questions and get answers where every sentence links to the exact page it came from.",
  },
  {
    title: "Build literature reviews",
    body: "Search Semantic Scholar, OpenAlex, arXiv and PubMed. Let Claude research for you, or screen papers rigorously with a PRISMA log.",
  },
  {
    title: "Write with citations",
    body: "Draft in an editor that knows your sources. Insert citations in any style, export to Word, PDF or LaTeX, and check every claim.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/sign-in" className="btn-ghost">Sign in</Link>
          <Link href="/sign-up" className="btn-primary">Get started</Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <section className="py-16 sm:py-24">
          <p className="mb-4 text-sm font-medium uppercase tracking-wider text-muted">AI research assistant · powered by Claude</p>
          <h1 className="max-w-3xl font-serif text-4xl leading-tight font-semibold sm:text-6xl">
            Research with sources you can actually check.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted">
            Jobiza turns your papers into a knowledge base you can question, helps you find the literature you&apos;re
            missing, and keeps every claim you write tied to its source. Bring your own Anthropic API key and pay only
            for what you use.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-up" className="btn-primary px-6 py-3 text-base">Create a free account</Link>
            <Link href="/sign-in" className="btn-secondary px-6 py-3 text-base">Sign in with ORCID or Google</Link>
          </div>
        </section>

        <section className="grid gap-4 pb-24 md:grid-cols-3">
          {pillars.map((p, i) => (
            <div key={p.title} className="card">
              <div className="mb-3 font-mono text-xs text-muted">0{i + 1}</div>
              <h2 className="mb-2 font-serif text-xl font-semibold">{p.title}</h2>
              <p className="text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted">
        Your papers and API key stay in your account. Keys are encrypted at rest.
      </footer>
    </div>
  );
}
