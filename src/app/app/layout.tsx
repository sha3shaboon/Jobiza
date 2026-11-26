import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { UserMenu } from "@/components/user-menu";
import { isDesktop } from "@/lib/env";
import { requireSession } from "@/server/session";

async function SessionGate({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="on-field grain relative flex shrink-0 flex-col md:sticky md:top-0 md:h-screen md:w-64">
        <div className="flex items-center justify-between px-4 py-4 md:px-5 md:py-6">
          <Logo href="/app" className="text-[25px]" />
          <div className="md:hidden">
            <UserMenu name={user.name} email={user.email} desktop={isDesktop()} compact />
          </div>
        </div>
        <NavLinks />
        <div className="mt-auto hidden border-t border-[var(--field-border)] p-4 md:block">
          <UserMenu name={user.name} email={user.email} desktop={isDesktop()} />
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-10 sm:px-10">
        {children}
      </main>
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
