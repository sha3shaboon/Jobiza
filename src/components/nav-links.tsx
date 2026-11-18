"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/app", label: "Home", phase: null },
  { href: "/app/library", label: "Library", phase: null },
  { href: "/app/ask", label: "Ask", phase: null },
  { href: "/app/reviews", label: "Literature reviews", phase: null },
  { href: "/app/writing", label: "Writing", phase: null },
  { href: "/app/settings", label: "Settings", phase: null },
] as const;

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:px-3 md:pb-0">
      {items.map((i) => {
        const active = i.href === "/app" ? path === "/app" : path.startsWith(i.href);
        if (i.phase) {
          return (
            <span
              key={i.href}
              title={`Coming in phase ${i.phase}`}
              aria-disabled="true"
              className="hidden min-h-10 shrink-0 items-center justify-between gap-2 rounded-[10px] px-3 text-[15px] text-[var(--field-muted)] opacity-70 md:flex"
            >
              {i.label}
              <span className="rounded-full border border-[var(--field-border)] px-2 py-0.5 text-[11px]">Soon</span>
            </span>
          );
        }
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-10 shrink-0 items-center rounded-[10px] px-3 text-[15px] transition-colors duration-150 ${active ? "bg-blossom font-medium text-[var(--blossom-fg)]" : "text-[var(--field-text)] hover:bg-field-2"}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
