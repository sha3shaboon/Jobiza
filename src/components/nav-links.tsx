"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/app", label: "Home", phase: null },
  { href: "/app/library", label: "Library", phase: 2 },
  { href: "/app/reviews", label: "Literature reviews", phase: 3 },
  { href: "/app/writing", label: "Writing", phase: 4 },
  { href: "/app/settings", label: "Settings", phase: null },
] as const;

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:px-3 md:pb-0">
      {items.map((i) => {
        const active = i.href === "/app" ? path === "/app" : path.startsWith(i.href);
        if (i.phase) {
          return (
            <span
              key={i.href}
              title={`Coming in phase ${i.phase}`}
              className="hidden shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-muted/70 md:flex"
            >
              {i.label}
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">soon</span>
            </span>
          );
        }
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`shrink-0 rounded-md px-3 py-2 text-sm ${active ? "bg-accent-soft font-medium text-accent" : "text-text hover:bg-surface-2"}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
