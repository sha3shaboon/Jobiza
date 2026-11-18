import Link from "next/link";

/* Geometry generated from the unopened buds of خُبَّيْزَة (Malva parviflora):
   a large bud seen from above (five twisted sepals closing in a star, a hint of
   petal inside) and two side buds on a short stem. */
const STEM = "M16 31.2 C15.6 27 16 24 16 19.5 M16 25.5 C13.5 25 11 24.6 9.4 25 M16 25.5 C18.5 25 21 24.6 22.6 25";
const SIDE_BUDS = "M6.7 15.8 C10.6 16.7 12.5 19.3 12.5 21.6 A4.3 4.1 0 0 1 3.9 21.6 C3.9 19.3 5.8 16.7 6.7 15.8Z M25.3 15.8 C26.2 16.7 28.1 19.3 28.1 21.6 A4.3 4.1 0 0 1 19.5 21.6 C19.5 19.3 21.4 16.7 25.3 15.8Z";
const SIDE_SEAMS = "M6.7 15.8 Q7.6 20.3 8.2 25.1 M6.7 15.8 Q5.8 19.5 5.8 24.2 M6.7 15.8 Q10.6 19.5 10.6 24.2 M25.3 15.8 Q24.4 20.3 23.8 25.1 M25.3 15.8 Q21.4 19.5 21.4 24.2 M25.3 15.8 Q26.2 19.5 26.2 24.2";
const TOP_SEAMS = "M16.0 11.6 Q16.2 8.1 18.0 4.9 M17.0 12.3 Q20.4 11.4 23.9 12.1 M16.6 13.4 Q18.5 16.4 18.9 20.0 M15.4 13.4 Q13.2 16.1 9.9 17.7 M15.0 12.3 Q11.8 11.0 9.3 8.3";
const PETAL_PEEK = "M16.0 11.0 L16.6 11.8 L17.5 12.1 L16.9 12.9 L16.9 13.9 L16.0 13.5 L15.1 13.9 L15.1 12.9 L14.5 12.1 L15.4 11.8Z";

/**
 * Buds about to open: research that's about to bloom.
 * Colors come from CSS tokens so it adapts to dark mode.
 */
export function MallowMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <path d={STEM} fill="none" stroke="var(--bud-edge)" strokeWidth="1.5" strokeLinecap="round" />
      <path d={SIDE_BUDS} fill="var(--bud-shade)" stroke="var(--bud-edge)" strokeWidth=".6" strokeLinejoin="round" />
      <path d={SIDE_SEAMS} fill="none" stroke="var(--bud-seam)" strokeWidth=".5" strokeLinecap="round" />
      <circle cx="16" cy="12.6" r="8.2" fill="var(--bud)" stroke="var(--bud-edge)" strokeWidth=".6" />
      <path d={TOP_SEAMS} fill="none" stroke="var(--bud-seam)" strokeWidth=".55" strokeLinecap="round" />
      <path d={PETAL_PEEK} fill="var(--petal-peek)" stroke="var(--bud-tip)" strokeWidth=".35" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ href = "/", arabic = true }: { href?: string; arabic?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2" aria-label="Jobiza home">
      <MallowMark size={28} />
      <span className="font-serif text-xl font-semibold tracking-tight">Jobiza</span>
      {arabic && (
        <span lang="ar" dir="rtl" className="font-arabic text-base leading-none text-stem">
          خُبَّيْزَة
        </span>
      )}
    </Link>
  );
}
