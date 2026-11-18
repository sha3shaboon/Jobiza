"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { signIn, signUp } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up";
type Method = "magic" | "password";

export function AuthForm({ mode, providers }: { mode: Mode; providers: { google: boolean; orcid: boolean } }) {
  const params = useSearchParams();
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/app";
  const [method, setMethod] = useState<Method>("magic");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function social(provider: "google" | "orcid") {
    setError(null);
    setBusy(true);
    const { error } = await signIn.social({ provider, callbackURL: next });
    if (error) {
      setError(error.message ?? "Could not start sign-in.");
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (method === "magic") {
        const { error } = await signIn.magicLink({ email, name: mode === "sign-up" ? name : undefined, callbackURL: next });
        if (error) throw new Error(error.message);
        setSent(true);
      } else if (mode === "sign-up") {
        const { error } = await signUp.email({ email, password, name, callbackURL: next });
        if (error) throw new Error(error.message);
        window.location.href = next;
      } else {
        const { error } = await signIn.email({ email, password, callbackURL: next });
        if (error) throw new Error(error.message);
        window.location.href = next;
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center" aria-live="polite">
        <h1 className="mb-2 text-3xl font-semibold tracking-[-0.02em]">Check your email</h1>
        <p className="text-sm text-muted">
          We sent a sign-in link to <strong className="text-text">{email}</strong>. It expires in 5 minutes.
        </p>
        <button className="btn-ghost mt-4" onClick={() => setSent(false)}>Use a different email</button>
      </div>
    );
  }

  const hasSocial = providers.google || providers.orcid;

  return (
    <div>
      <h1 className="mb-2 text-3xl font-semibold tracking-[-0.02em]">{mode === "sign-in" ? "Welcome back" : "Create your account"}</h1>
      <p className="mb-8 text-muted">
        {mode === "sign-in" ? "Sign in to your research library." : "Start a library of the papers you're reading."}
      </p>

      {hasSocial && (
        <>
          <div className="grid gap-2">
            {providers.orcid && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => social("orcid")}>
                <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#a6ce39] text-[10px] font-bold text-white">iD</span>
                Continue with ORCID
              </button>
            )}
            {providers.google && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => social("google")}>
                <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
                  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
                </svg>
                Continue with Google
              </button>
            )}
          </div>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-border" /> or with email <div className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <div className="mb-5 grid grid-cols-2 rounded-[10px] bg-surface-2 p-1 text-sm" role="tablist" aria-label="Sign-in method">
        {(["magic", "password"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={method === m}
            onClick={() => setMethod(m)}
            className={`min-h-9 rounded-[8px] px-3 ${method === m ? "bg-surface font-medium text-text ring-1 ring-border" : "text-muted hover:text-text"}`}
          >
            {m === "magic" ? "Email link" : "Password"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="grid gap-4">
        {mode === "sign-up" && (
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" spellCheck={false} className="input" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        {method === "password" && (
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            />
            {mode === "sign-up" && <p className="mt-1 text-xs text-muted">At least 10 characters.</p>}
          </div>
        )}
        {error && <p className="rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger" role="alert">{error}</p>}
        <button className="btn-primary" disabled={busy}>
          {busy ? "Please wait…" : method === "magic" ? "Email me a sign-in link" : mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === "sign-in" ? (
          <>New here? <Link href={`/sign-up${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`} className="link">Create an account</Link></>
        ) : (
          <>Already have an account? <Link href="/sign-in" className="link">Sign in</Link></>
        )}
      </p>
    </div>
  );
}
