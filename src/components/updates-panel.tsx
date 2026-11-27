"use client";

import { useEffect, useState } from "react";
import { updatesApi, type UpdateState, type UpdatesApi } from "@/lib/updates";
import { SettingRow } from "./settings-panel";

/** Follows the app shell's update state (desktop and Android only). */
export function useUpdates() {
  const [api, setApi] = useState<UpdatesApi | null>(null);
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const a = updatesApi();
    if (!a) return;
    let live = true;
    const off = a.onChange((s) => live && setState(s));
    void a.getState().then((s) => {
      if (!live) return;
      setApi(a);
      setState(s);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return { api, state, setState };
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function UpdatesPanel() {
  const { api, state, setState } = useUpdates();
  if (!api || !state) return null;
  const busy = state.status === "checking" || state.status === "downloading";
  const phone = api.platform === "android";

  const line = (() => {
    switch (state.status) {
      case "checking":
        return "Checking GitHub for a new version…";
      case "latest":
        return `You have the latest version.${state.checkedAt ? ` Checked ${when.format(new Date(state.checkedAt))}.` : ""}`;
      case "available":
        return `Jobiza ${state.latest} is available.`;
      case "downloading":
        return `Downloading Jobiza ${state.latest}… ${state.progress ?? 0}%`;
      case "ready":
        return phone ? `Jobiza ${state.latest} is downloaded and ready to install.` : `Jobiza ${state.latest} is ready. It installs when you close Jobiza, or restart now.`;
      case "permission":
      case "error":
      case "unsupported":
        return state.error;
      default:
        return state.auto ? "Jobiza checks for updates automatically." : "Automatic updates are off.";
    }
  })();

  return (
    <SettingRow
      id="updates"
      title="Updates"
      status={
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${state.status === "ready" || state.status === "available" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"}`}>
          Version {state.version}
        </span>
      }
      description={
        <p>
          New versions come from Jobiza&apos;s releases on GitHub.{" "}
          {phone
            ? "Downloads happen on Wi-Fi, and Android asks you to confirm each install. Your library is kept."
            : "They download in the background and install the next time Jobiza closes. Your library is kept."}
        </p>
      }
    >
      <div className="grid gap-4">
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-1" checked={state.auto} disabled={state.status === "unsupported"} onChange={(e) => {
              // Show the change at once; the app confirms it a moment later.
              setState({ ...state, auto: e.target.checked });
              void api.setAuto(e.target.checked);
            }}
          />
          <span>
            <span className="font-medium">Update automatically</span>
            <span className="block text-sm text-muted">
              {phone ? "Check every few hours and download new versions on Wi-Fi." : "Check every few hours and download new versions in the background."}
            </span>
          </span>
        </label>

        <p className={`text-sm ${state.status === "error" || state.status === "permission" ? "text-danger" : "text-muted"}`} aria-live="polite">
          {line}
        </p>
        {state.status === "downloading" && (
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={state.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${state.progress ?? 0}%` }} />
          </div>
        )}
        {state.notes && (state.status === "available" || state.status === "ready" || state.status === "downloading") && (
          <details className="rounded-[10px] border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">What&apos;s new in {state.latest}</summary>
            <p className="mt-2 whitespace-pre-line text-muted">{state.notes}</p>
          </details>
        )}

        <div className="flex flex-wrap gap-2">
          {(state.status === "ready" || state.status === "permission") && (
            <button className="btn-primary" onClick={() => void api.install()}>
              {phone ? "Install update" : "Restart and update"}
            </button>
          )}
          {state.status === "available" && (
            <button className="btn-primary" onClick={() => void api.download()}>
              Download Jobiza {state.latest}
            </button>
          )}
          {state.status !== "unsupported" && state.status !== "ready" && (
            <button className="btn-secondary" disabled={busy} onClick={() => void api.check()}>
              {state.status === "checking" ? "Checking…" : "Check for updates"}
            </button>
          )}
        </div>
      </div>
    </SettingRow>
  );
}

/** A quiet banner at the top of the app when a new version is ready to install. */
export function UpdateBanner() {
  const { api, state } = useUpdates();
  const [hidden, setHidden] = useState<string | null>(null);
  if (!api || !state || state.status !== "ready" || hidden === state.latest) return null;
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-[12px] border border-border bg-accent-soft px-4 py-3 text-sm">
      <span className="font-medium text-accent">Jobiza {state.latest} is ready to install.</span>
      <button className="btn-primary min-h-9 px-3 text-sm" onClick={() => void api.install()}>
        {api.platform === "android" ? "Install" : "Restart and update"}
      </button>
      <button className="btn-ghost min-h-9 px-3 text-sm" onClick={() => setHidden(state.latest)}>
        Later
      </button>
    </div>
  );
}
