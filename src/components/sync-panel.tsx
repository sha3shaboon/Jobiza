"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { SettingRow } from "./settings-panel";

type Status = {
  device: { id: string; name: string; enabled: boolean; running: boolean; port: number | null; addresses: string[] };
  peers: { id: string; name: string; lastSyncAt: string | null; lastSeenAt: string | null; lastError: string | null; syncing: boolean }[];
};

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function ago(iso: string) {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (s > -60) return "just now";
  if (s > -3600) return relative.format(Math.round(s / 60), "minute");
  if (s > -86400) return relative.format(Math.round(s / 3600), "hour");
  return relative.format(Math.round(s / 86400), "day");
}

/** Desktop and Android apps: pair devices and see when each last synced. */
export function SyncPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<"invite" | "join" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api<Status>("/api/v1/sync"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function syncNow() {
    setBusy(true);
    try {
      setStatus(await api<Status>("/api/v1/sync/now", { method: "POST" }));
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: { name?: string; enabled?: boolean }) {
    setStatus(await api<Status>("/api/v1/sync", { method: "PATCH", body: JSON.stringify(body) }));
  }

  async function forget(id: string, name: string) {
    if (!confirm(`Stop syncing with ${name}? What's already on this device stays.`)) return;
    await api(`/api/v1/sync/peers/${id}`, { method: "DELETE" });
    await load();
  }

  const peers = status?.peers ?? [];
  return (
    <SettingRow
      id="sync"
      title="Devices and sync"
      status={
        status && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.device.running ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted"}`}>
            {status.device.running ? "On" : "Off"}
          </span>
        )
      }
      description={
        <>
          <p>Each device keeps its own complete library and works on its own. Paired devices swap changes whenever both are open on the same Wi-Fi network.</p>
          <p className="mt-2">Everything they send each other is encrypted with a key only the paired devices have.</p>
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-4 rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      {status && (
        <div className="grid gap-6">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label htmlFor="device-name" className="label">
                This device&apos;s name
              </label>
              <input
                id="device-name"
                className="input"
                defaultValue={status.device.name}
                maxLength={60}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== status.device.name && void patch({ name: e.target.value.trim() })}
              />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={status.device.enabled} onChange={(e) => void patch({ enabled: e.target.checked })} />
              Sync with other devices
            </label>
          </div>

          <div>
            <h3 className="font-medium">Paired devices</h3>
            {peers.length === 0 ? (
              <p className="mt-1 text-sm text-muted">None yet. Pair your phone or another computer to keep the same library on both.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border rounded-[12px] border border-border">
                {peers.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium break-words">{p.name}</p>
                      <p className="text-sm text-muted">
                        {p.syncing
                          ? "Syncing…"
                          : p.lastError
                            ? `${p.lastError}${p.lastSyncAt ? `. Last synced ${ago(p.lastSyncAt)}.` : ""}`
                            : p.lastSyncAt
                              ? `Synced ${ago(p.lastSyncAt)}`
                              : "Waiting for the first sync"}
                      </p>
                    </div>
                    <button className="btn-ghost min-h-10 px-3 text-sm hover:text-danger" onClick={() => void forget(p.id, p.name)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => setPairing("invite")} disabled={!status.device.running}>
              Pair a new device
            </button>
            <button className="btn-secondary" onClick={() => setPairing("join")} disabled={!status.device.running}>
              Enter a pairing code
            </button>
            {peers.length > 0 && (
              <button className="btn-ghost" onClick={() => void syncNow()} disabled={busy || !status.device.running}>
                {busy ? "Syncing…" : "Sync now"}
              </button>
            )}
          </div>
        </div>
      )}
      {pairing && <PairDialog mode={pairing} onMode={setPairing} onDone={() => void load()} onClose={() => setPairing(null)} />}
    </SettingRow>
  );
}

function PairDialog({ mode, onMode, onDone, onClose }: { mode: "invite" | "join"; onMode: (m: "invite" | "join") => void; onDone: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="pair-title"
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-[16px] border border-border bg-surface p-0 text-text backdrop:bg-black/40"
    >
      <div className="p-6">
        <h2 id="pair-title" className="text-xl font-semibold">
          Pair a device
        </h2>
        <div role="tablist" aria-label="Pairing" className="mt-4 inline-flex rounded-[10px] bg-surface-2 p-1 text-sm">
          {(
            [
              ["invite", "Show a code here"],
              ["join", "Use a code from another device"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => onMode(m)}
              className={`min-h-9 rounded-[8px] px-3 ${mode === m ? "bg-surface font-medium text-text ring-1 ring-border" : "text-muted hover:text-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-5">{mode === "invite" ? <Invite onDone={onDone} /> : <Join onDone={onDone} />}</div>
      </div>
      <div className="flex justify-end border-t border-border px-6 py-4">
        <button className="btn-ghost" onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}

/** Show an invitation (QR code + text) and wait for the other device to use it. */
function Invite({ onDone }: { onDone: () => void }) {
  const [shareKey, setShareKey] = useState(true);
  const [offer, setOffer] = useState<{ id: string; text: string; expiresAt: string; qr: string } | null>(null);
  const [state, setState] = useState<"idle" | "waiting" | "paired" | "expired">("idle");
  const [peerName, setPeerName] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make() {
    setError(null);
    try {
      const o = await api<{ id: string; text: string; expiresAt: string }>("/api/v1/sync/offers", { method: "POST", body: JSON.stringify({ shareApiKey: shareKey }) });
      const QR = await import("qrcode");
      const qr = await QR.toDataURL(o.text, { errorCorrectionLevel: "M", margin: 2, width: 280, color: { dark: "#183021", light: "#ffffff" } });
      setOffer({ ...o, qr });
      setState("waiting");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (state !== "waiting" || !offer) return;
    const t = setInterval(async () => {
      const s = await api<{ state: "waiting" | "paired" | "expired"; peerName?: string }>(`/api/v1/sync/offers/${offer.id}`).catch(() => null);
      if (!s || s.state === "waiting") return;
      setState(s.state);
      if (s.state === "paired") {
        setPeerName(s.peerName ?? "The other device");
        onDone();
      }
    }, 2000);
    return () => clearInterval(t);
  }, [state, offer, onDone]);

  if (state === "paired")
    return (
      <p className="rounded-[10px] bg-accent-soft px-4 py-3 text-accent" role="status">
        Paired with {peerName}. Your library is copying over now.
      </p>
    );
  if (!offer || state === "expired")
    return (
      <div className="grid gap-4">
        {state === "expired" && <p className="text-sm text-danger">That code expired. Make a new one.</p>}
        <p className="text-sm text-muted">On the other device, open Settings, then Devices and sync, then Enter a pairing code. Scan this code or paste it there.</p>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5" checked={shareKey} onChange={(e) => setShareKey(e.target.checked)} />
          <span>Also copy my Anthropic API key to that device, so I don&apos;t have to enter it again</span>
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button className="btn-primary justify-self-start" onClick={() => void make()}>
          Show a pairing code
        </button>
      </div>
    );
  return (
    <div className="grid justify-items-center gap-4 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
      <img src={offer.qr} alt="Pairing code as a QR code" width={280} height={280} className="rounded-[12px] border border-border" />
      <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
        <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-cite motion-reduce:animate-none" />
        Waiting for the other device. The code works once, for 10 minutes.
      </p>
      <button
        className="btn-secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(offer.text);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy the code as text"}
      </button>
      <p className="text-xs text-muted">Both devices need to be on the same Wi-Fi network with Jobiza open.</p>
    </div>
  );
}

/** Scan or paste another device's invitation. */
function Join({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  const join = useCallback(
    async (text: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = await api<{ name: string; apiKeyCopied: boolean }>("/api/v1/sync/join", { method: "POST", body: JSON.stringify({ code: text }) });
        setResult(`Paired with ${r.name}.${r.apiKeyCopied ? " Your API key was copied too." : ""} The library is copying over now.`);
        onDone();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );

  // Camera scanning: read frames into a canvas and look for a QR code.
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const jsQR = (await import("jsqr")).default;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const tick = () => {
          const v = video.current;
          if (stopped || !v) return;
          if (v.videoWidth) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (found?.data.startsWith("jobiza-pair:")) {
              setScanning(false);
              setCode(found.data);
              void join(found.data);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setError("The camera isn't available. Paste the code instead.");
        setScanning(false);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning, join]);

  if (result)
    return (
      <p className="rounded-[10px] bg-accent-soft px-4 py-3 text-accent" role="status">
        {result}
      </p>
    );
  return (
    <div className="grid gap-4">
      {scanning ? (
        <div className="grid gap-2">
          <video ref={video} className="aspect-square w-full rounded-[12px] bg-black object-cover" muted playsInline />
          <button className="btn-ghost justify-self-start" onClick={() => setScanning(false)}>
            Stop scanning
          </button>
        </div>
      ) : (
        <button className="btn-primary justify-self-start" onClick={() => setScanning(true)}>
          Scan the QR code
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void join(code);
        }}
        className="grid gap-2"
      >
        <label htmlFor="pair-code" className="label">
          Or paste the code
        </label>
        <textarea id="pair-code" rows={3} className="input resize-y py-2.5 font-mono text-xs" value={code} onChange={(e) => setCode(e.target.value)} placeholder="jobiza-pair:1:…" />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button className="btn-secondary justify-self-start" disabled={busy || code.trim().length < 20}>
          {busy ? "Pairing…" : "Pair"}
        </button>
      </form>
    </div>
  );
}
