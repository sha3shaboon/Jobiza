import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { UserMenu } from "@/components/user-menu";
import { requireSession } from "@/server/session";

async function SessionGate({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border bg-surface md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-4 md:px-5">
          <Logo href="/app" className="text-[25px]" />
          <div className="md:hidden">
            <UserMenu name={user.name} email={user.email} compact />
          </div>
        </div>
        <NavLinks />
        <div className="mt-auto hidden border-t border-border p-3 md:block">
          <UserMenu name={user.name} email={user.email} />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted">Loading…</div>}>
      <SessionGate>{children}</SessionGate>
    </Suspense>
  );
}
