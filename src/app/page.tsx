import Link from "next/link";
import { Blossom, Logo } from "@/components/logo";

const stages = [
  {
    verb: "Plant",
    title: "Chat with your library",
    body: "Drop in PDFs or import by DOI. Ask questions and get answers where every sentence links back to the exact page it came from.",
  },
  {
    verb: "Spread",
    title: "Grow a literature review",
    body: "Let it reach across Semantic Scholar, OpenAlex, arXiv and PubMed. It can research on its own, or you can screen every paper yourself with a PRISMA log.",
  },
  {
    verb: "Harvest",
    title: "Write with citations",
    body: "Draft in an editor that knows your sources. Cite in any style, export to Word, PDF or LaTeX, and check every claim before you submit.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo className="text-[30px]" />
        <nav className="flex items-center gap-2">
          <Link href="/sign-in" className="btn-ghost">Sign in</Link>
          <Link href="/sign-up" className="btn-primary">Get started</Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <section className="relative py-16 sm:py-24">
          <Blossom
            size={340}
            className="pointer-events-none absolute top-0 right-[-60px] hidden opacity-[0.12] md:block lg:right-0 dark:md:hidden"
          />
          <p className="mb-4 text-sm font-medium uppercase tracking-wider text-stem">
            A research assistant powered by Claude
          </p>
          <h1 className="relative max-w-3xl font-serif text-4xl leading-tight font-semibold sm:text-6xl">
            Plant your sources.
            <br />
            <span className="text-accent">Watch your research grow.</span>
          </h1>
          <p className="relative mt-6 max-w-2xl text-lg text-muted">
            Add your papers and your library grows its own connections, summaries and citations, so every claim you
            write stays rooted in a source you can check. Bring your own Anthropic API key and pay only for what you
            use.
          </p>
          <div className="relative mt-8 flex flex-wrap gap-3">
            <Link href="/sign-up" className="btn-primary px-6 py-3 text-base">Start your library</Link>
            <Link href="/sign-in" className="btn-secondary px-6 py-3 text-base">Sign in with ORCID or Google</Link>
          </div>
        </section>

        <section className="grid gap-4 pb-20 md:grid-cols-3">
          {stages.map((s, i) => (
            <div key={s.verb} className="card">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-stem">
                <span className="font-mono text-muted">0{i + 1}</span> {s.verb}
              </div>
              <h2 className="mb-2 font-serif text-xl font-semibold">{s.title}</h2>
              <p className="text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </section>

        <section id="name" className="mb-24 grid items-center gap-10 rounded-2xl bg-accent-soft px-6 py-12 sm:px-12 md:grid-cols-[1fr_1.4fr]">
          <div className="text-center md:text-left">
            <Blossom size={56} className="mx-auto mb-4 md:mx-0" />
            <p lang="ar" dir="rtl" className="font-arabic text-6xl leading-tight text-accent sm:text-7xl md:text-left">
              خُبَّيْزَة
            </p>
            <p className="mt-3 text-sm text-muted">
              <em>khubbayza</em> · <em>Malva parviflora</em> · cheeseweed
            </p>
          </div>
          <div className="grid gap-4 leading-relaxed">
            <h2 className="font-serif text-2xl font-semibold sm:text-3xl">About the name</h2>
            <p>
              Nobody plants <em>khubbayza</em>. After the winter rains it comes up on its own: in fields, along
              roadsides, through cracks in the pavement. Families across the Levant and Egypt have foraged and cooked it
              for generations. It&apos;s humble, resilient and quietly nourishing.
            </p>
            <p>
              That&apos;s what we want Jobiza to be: something that grows out of whatever sources you give it, thrives
              on a student budget, and feeds the work you&apos;re actually trying to do.
            </p>
            <p className="text-sm text-muted">
              The dot on our &ldquo;i&rdquo; is its blossom: five small notched petals, the flower every one of those
              wild plants opens into. (The English name, cheeseweed, comes from its seed pods, which look like tiny
              wheels of cheese.)
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted">
        <Logo href={null} className="text-sm" /> · grows wherever you plant it. Your papers
        and API key stay in your account, and keys are encrypted at rest.
      </footer>
    </div>
  );
}
