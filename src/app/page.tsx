import Link from "next/link";
import { Logo } from "@/components/logo";

const capabilities = [
  {
    title: "Ask your library",
    body: "Upload PDFs or import by DOI, then ask questions in plain language. Answers come only from your papers and link to the page they used.",
  },
  {
    title: "Grow a literature review",
    body: "Search Semantic Scholar, OpenAlex, arXiv and PubMed. Let Jobiza research on its own, or screen each paper yourself and keep a PRISMA log.",
  },
  {
    title: "Write with citations",
    body: "Draft in an editor that knows your sources. Cite in APA, MLA, Chicago and more, export to Word, PDF or LaTeX, and check each claim before you submit.",
  },
];

const sampleNotes = [
  { n: 1, author: "Rahman et al. (2024)", quote: "recall fell by 19% after restriction", where: "Journal of Adolescent Health, p. 7" },
  { n: 2, author: "Okafor and Lind (2023)", quote: "emotional items showed the steepest decline", where: "Sleep Medicine, p. 112" },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="on-field grain">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
          <Logo className="text-[28px]" />
          <nav aria-label="Account" className="flex items-center gap-1 sm:gap-3">
            <Link href="/sign-in" className="btn-ghost px-3 whitespace-nowrap text-[var(--field-text)] hover:bg-field-2 hover:text-[var(--field-text)]">
              Sign in
            </Link>
            <Link href="/sign-up" className="btn-blossom hidden px-4 whitespace-nowrap sm:inline-flex">
              Start your library
            </Link>
          </nav>
        </header>

        <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 pt-12 text-center sm:px-8 md:pt-16">
          <h1 className="max-w-[23ch] text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.025em] sm:text-5xl md:text-[3.75rem]">
            Ask your papers anything. Every answer cites the page.
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-[var(--field-muted)]">
            Jobiza reads the papers you add and answers your questions from them, citing the exact page every time. Like
            khubbayza after the rain, your library grows on its own.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
            <Link href="/sign-up" className="btn-blossom px-6">
              Start your library
            </Link>
            <Link href="/sign-in" className="link decoration-blossom">
              Sign in with ORCID or Google
            </Link>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration with filters */}
          <img
            src="/illustrations/research-shelf.svg"
            alt="A shelf of research tools with faces: books, a highlighter, a magnifying glass with an eye, a highlighted paper, and a potted khubbayza in bloom"
            width={1000}
            height={560}
            fetchPriority="high"
            className="mt-12 -mb-px block h-auto w-full max-w-[1000px]"
          />
        </section>
      </div>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-8">
        <section className="grid gap-x-12 gap-y-8 py-20 md:grid-cols-[minmax(0,40rem)_1fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.015em] sm:text-3xl">See where every answer comes from</h2>
            <p className="mt-3 max-w-[36rem] text-muted">
              Claims are highlighted in the answer and traced to the margin: which paper, which page, and the exact words
              it was based on.
            </p>
            <figure className="mt-8 border-t border-border pt-6">
              <figcaption className="text-sm text-muted">Example from a sample library</figcaption>
              <p className="mt-2 text-sm text-muted">You asked: does sleep loss affect memory in teenagers?</p>
              <p className="mt-3 text-lg leading-[1.7]">
                Yes. One night of restricted sleep <span className="cited">reduced next-day recall by about a fifth</span>
                <sup className="ml-0.5 text-xs font-semibold text-cite">1</sup>, and{" "}
                <span className="cited">emotional material was affected most</span>
                <sup className="ml-0.5 text-xs font-semibold text-cite">2</sup>.
              </p>
            </figure>
          </div>
          <aside aria-label="Sources for the example answer" className="md:border-l md:border-border md:pt-24 md:pl-8">
            <ol className="grid gap-6">
              {sampleNotes.map((s) => (
                <li key={s.n} className="flex gap-3 text-sm leading-relaxed">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cite text-[11px] font-semibold text-white dark:text-[var(--bg)]">
                    {s.n}
                  </span>
                  <span>
                    <span className="font-medium">{s.author}</span>
                    <span className="mt-1 block text-[15px] italic">&ldquo;{s.quote}&rdquo;</span>
                    <span className="mt-1 block text-muted">{s.where}</span>
                  </span>
                </li>
              ))}
            </ol>
          </aside>
        </section>

        <section aria-labelledby="what" className="border-t border-border py-20">
          <h2 id="what" className="text-2xl font-semibold tracking-[-0.015em] sm:text-3xl">
            From first paper to finished draft
          </h2>
          <dl className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-3">
            {capabilities.map((c) => (
              <div key={c.title} className="border-t-2 border-accent pt-4">
                <dt className="text-lg font-semibold">{c.title}</dt>
                <dd className="mt-2 leading-relaxed text-muted">{c.body}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <section id="name" aria-labelledby="name-title" className="on-field grain">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-20 sm:px-8 md:grid-cols-[1fr_1.4fr]">
          <div>
            <p lang="ar" dir="rtl" className="font-naskh text-7xl leading-tight text-blossom md:text-left">
              خُبَّيْزَة
            </p>
            <p className="mt-3 text-sm text-[var(--field-muted)]">
              <em>khubbayza</em>, <em>Malva parviflora</em>, or cheeseweed
            </p>
          </div>
          <div className="grid max-w-[38rem] gap-4 leading-relaxed">
            <h2 id="name-title" className="text-2xl font-semibold tracking-[-0.015em]">
              About the name
            </h2>
            <p>
              Nobody plants khubbayza. After the winter rains it comes up on its own: in fields, along roadsides, through
              cracks in the pavement. Families across the Levant and Egypt have foraged and cooked it for generations.
            </p>
            <p>
              That&apos;s what Jobiza is for: something that grows out of whatever sources you give it, fits a student
              budget, and feeds the work you&apos;re actually doing. The dot on our &ldquo;i&rdquo; is its blossom.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-muted sm:px-8">
          <Logo href={null} className="text-base" />
          <p>Your papers and API key stay in your account. Keys are encrypted at rest.</p>
        </div>
      </footer>
    </div>
  );
}
