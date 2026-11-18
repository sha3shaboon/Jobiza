import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/server/session";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Home" };

export default async function Dashboard() {
  const { user } = await requireSession();
  const settings = await getSettings(user.id);
  const steps = [
    { done: true, label: "Create your account", href: null },
    { done: settings.hasApiKey, label: "Add your Anthropic API key", href: "/app/settings" },
    { done: Boolean(settings.model), label: "Choose a Claude model", href: "/app/settings" },
    { done: false, label: "Upload your first paper (coming in phase 2)", href: null },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-3xl font-semibold">Hello, {user.name.split(" ")[0]}</h1>
      <p className="mt-2 text-muted">Let&apos;s get your research workspace ready.</p>

      <section className="card mt-8">
        <h2 className="mb-4 font-semibold">Getting started</h2>
        <ol className="grid gap-3">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${s.done ? "border-success bg-success text-white" : "border-border"}`}
                aria-label={s.done ? "done" : "to do"}
              >
                {s.done ? "✓" : ""}
              </span>
              {s.href && !s.done ? (
                <Link href={s.href} className="text-accent underline">{s.label}</Link>
              ) : (
                <span className={s.done ? "text-muted line-through" : ""}>{s.label}</span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
