import Link from "next/link";

const PETAL = "M50 50C43 46 33 33 37 20C39.5 12 47 11 50 18C53 11 60.5 12 63 20C67 33 57 46 50 50Z";

/** Flat five-petal mallow blossom (خُبَّيْزَة). Used as the i's dot and as the app icon. */
export function Blossom({ size, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
      <g fill="var(--blossom)">
        {[0, 72, 144, 216, 288].map((deg) => (
          <path key={deg} d={PETAL} transform={`rotate(${deg} 50 50)`} />
        ))}
      </g>
      <circle cx="50" cy="50" r="7" fill="var(--blossom-centre)" />
    </svg>
  );
}

/** "jobiza" set in Fraunces, with a blossom in place of the i's dot. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`} role="img" aria-label="Jobiza">
      <span aria-hidden>
        job
        <span className="wordmark-i">
          ı<Blossom className="wordmark-dot" />
        </span>
        za
      </span>
    </span>
  );
}

const ARABIC = "خُبَّيْزَة";

/**
 * Logo lockups.
 * - `inline`: Arabic beside the wordmark with a hairline divider (headers, nav).
 * - `stacked`: Arabic underneath, aligned under "za" (landing, sign-in, brand moments).
 * Size is driven by font-size: set a text-* class on `className`.
 */
export function Logo({
  href = "/",
  layout = "inline",
  className = "text-2xl",
}: {
  href?: string | null;
  layout?: "inline" | "stacked";
  className?: string;
}) {
  const body =
    layout === "inline" ? (
      <span className={`inline-flex items-center gap-[0.45em] ${className}`}>
        <Wordmark />
        <span className="w-px self-stretch bg-border" aria-hidden />
        <span lang="ar" dir="rtl" className="font-arabic text-[0.62em] leading-none text-stem">
          {ARABIC}
        </span>
      </span>
    ) : (
      <span className={`inline-flex flex-col items-end leading-none ${className}`}>
        <Wordmark />
        <span lang="ar" dir="rtl" className="mt-[0.14em] font-arabic text-[0.42em] leading-none text-stem">
          {ARABIC}
        </span>
      </span>
    );
  if (!href) return body;
  return (
    <Link href={href} aria-label="Jobiza home" className="inline-flex">
      {body}
    </Link>
  );
}
