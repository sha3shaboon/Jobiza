"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function UserMenu({ name, email, compact = false, desktop = false }: { name: string; email: string; compact?: boolean; desktop?: boolean }) {
  const router = useRouter();
  const displayEmail = desktop ? "Library on this computer" : email.endsWith("@orcid.invalid") ? "Signed in with ORCID" : email;
  const onSignOut = async () => {
    await signOut();
    router.push("/");
    router.refresh();
  };
  // The desktop app has one local account and nothing to sign out of.
  if (compact && desktop) return null;
  if (compact) {
    return (
      <button className="btn-ghost min-h-9 px-2.5 text-sm text-[var(--field-muted)] hover:bg-field-2 hover:text-[var(--field-text)]" onClick={onSignOut} title={`Signed in as ${name}`}>
        Sign out
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blossom text-sm font-semibold text-[var(--blossom-fg)]">
        {name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="truncate text-xs text-muted">{displayEmail}</div>
      </div>
      {!desktop && (
        <button className="btn-ghost min-h-9 px-2.5 text-sm text-[var(--field-muted)] hover:bg-field-2 hover:text-[var(--field-text)]" onClick={onSignOut}>
          Sign out
        </button>
      )}
    </div>
  );
}
