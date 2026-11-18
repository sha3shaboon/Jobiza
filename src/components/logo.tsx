import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-serif text-xl font-semibold tracking-tight">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 5.5C4 4.67 4.67 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" fill="currentColor" opacity=".25" />
        <path d="M13 4h5.5c.83 0 1.5.67 1.5 1.5v13c0 .83-.67 1.5-1.5 1.5H13V4Z" fill="currentColor" opacity=".55" />
        <path d="M7 8h2M7 11h2M15 8h2M15 11h2M15 14h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      Jobiza
    </Link>
  );
}
