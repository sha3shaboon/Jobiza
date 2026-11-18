"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function UserMenu({ name, email, compact = false }: { name: string; email: string; compact?: boolean }) {
  const router = useRouter();
  const displayEmail = email.endsWith("@orcid.invalid") ? "Signed in with ORCID" : email;
  const onSignOut = async () => {
    await signOut();
    router.push("/");
    router.refresh();
  };
  if (compact) {
    return (
      <button className="btn-ghost px-2 py-1 text-xs" onClick={onSignOut} title={`Signed in as ${name}`}>
        Sign out
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
        {name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="truncate text-xs text-muted">{displayEmail}</div>
      </div>
      <button
        className="btn-ghost px-2 py-1 text-xs"
        onClick={onSignOut}
      >
        Sign out
      </button>
    </div>
  );
}
