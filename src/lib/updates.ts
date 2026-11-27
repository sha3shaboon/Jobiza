"use client";

/**
 * Update controls for the desktop and Android apps. Each app shell exposes a
 * small bridge (desktop/preload.cjs → window.jobizaUpdates, Android
 * MainActivity → window.JobizaAndroid); this gives both one shape. On the web
 * there's no bridge and updates come with the server.
 */
export type UpdateState = {
  version: string;
  auto: boolean;
  status: "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "error" | "unsupported" | "permission";
  latest: string | null;
  progress: number | null;
  notes: string | null;
  error: string | null;
  checkedAt: string | null;
};

export type UpdatesApi = {
  platform: "desktop" | "android";
  getState(): Promise<UpdateState>;
  check(): Promise<unknown>;
  download(): Promise<unknown>;
  install(): Promise<unknown>;
  setAuto(on: boolean): Promise<unknown>;
  onChange(callback: (s: UpdateState) => void): () => void;
};

type AndroidBridge = {
  getUpdateState(): string;
  setAutoUpdate(on: boolean): void;
  checkForUpdate(): void;
  downloadUpdate(): void;
  installUpdate(): void;
};

type Win = Window & { jobizaUpdates?: UpdatesApi; JobizaAndroid?: AndroidBridge; __jobizaUpdate?: (s: UpdateState) => void };

const listeners = new Set<(s: UpdateState) => void>();

export function updatesApi(): UpdatesApi | null {
  if (typeof window === "undefined") return null;
  const w = window as Win;
  if (w.jobizaUpdates) return w.jobizaUpdates;
  const a = w.JobizaAndroid;
  if (!a) return null;
  // The Android shell calls window.__jobizaUpdate(state) whenever something changes.
  w.__jobizaUpdate = (s) => listeners.forEach((l) => l(s));
  const read = async () => JSON.parse(a.getUpdateState()) as UpdateState;
  return {
    platform: "android",
    getState: read,
    check: async () => a.checkForUpdate(),
    download: async () => a.downloadUpdate(),
    install: async () => a.installUpdate(),
    setAuto: async (on) => a.setAutoUpdate(on),
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
