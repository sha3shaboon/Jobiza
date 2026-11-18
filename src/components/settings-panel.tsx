"use client";

import { useCallback, useEffect, useState } from "react";

type Settings = {
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  apiKeyVerifiedAt: string | null;
  model: string | null;
  citationStyle: string;
};
type Model = { id: string; displayName: string; createdAt: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function SettingsPanel({
  initial,
  citationStyles,
}: {
  initial: Settings;
  citationStyles: { id: string; label: string }[];
}) {
  const [settings, setSettings] = useState(initial);
  const [models, setModels] = useState<Model[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const fetchModels = useCallback(
    () =>
      api<{ models: Model[] }>("/api/v1/models").then(
        ({ models }) => {
          setModels(models);
          setModelsError(null);
        },
        (e: Error) => {
          setModels([]);
          setModelsError(e.message);
        },
      ),
    [],
  );

  useEffect(() => {
    if (!settings.hasApiKey) return;
    let cancelled = false;
    api<{ models: Model[] }>("/api/v1/models").then(
      ({ models }) => {
        if (!cancelled) setModels(models);
      },
      (e: Error) => {
        if (cancelled) return;
        setModels([]);
        setModelsError(e.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [settings.hasApiKey]);

  return (
    <div className="mt-8 grid gap-6">
      <ApiKeyCard
        settings={settings}
        onSaved={(s, m) => {
          setSettings(s);
          setModels(m);
        }}
        onRemoved={(s) => {
          setSettings(s);
          setModels(null);
        }}
      />
      <ModelCard settings={settings} models={models} error={modelsError} onRetry={() => void fetchModels()} onChange={setSettings} />
      <CitationCard settings={settings} styles={citationStyles} onChange={setSettings} />
    </div>
  );
}

function ApiKeyCard({
  settings,
  onSaved,
  onRemoved,
}: {
  settings: Settings;
  onSaved: (s: Settings, models: Model[]) => void;
  onRemoved: (s: Settings) => void;
}) {
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(!settings.hasApiKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ settings: Settings; models: Model[] }>("/api/v1/settings/api-key", {
        method: "PUT",
        body: JSON.stringify({ apiKey: key }),
      });
      setKey("");
      setEditing(false);
      onSaved(r.settings, r.models);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remove your API key? AI features will stop working until you add one again.")) return;
    setBusy(true);
    try {
      onRemoved(await api<Settings>("/api/v1/settings/api-key", { method: "DELETE" }));
      setEditing(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="font-semibold">Anthropic API key</h2>
        {settings.hasApiKey && (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Connected</span>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">
        Create a key in the{" "}
        <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer" className="text-accent underline">
          Claude Console
        </a>
        . We check it with Anthropic (this costs nothing), then store it encrypted.
      </p>

      {settings.hasApiKey && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-2 px-4 py-3">
          <div className="text-sm">
            <span className="font-mono">sk-ant-…{settings.apiKeyLast4}</span>
            {settings.apiKeyVerifiedAt && (
              <span className="ml-2 text-muted">verified {new Date(settings.apiKeyVerifiedAt).toLocaleDateString()}</span>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setEditing(true)} disabled={busy}>Replace</button>
            <button className="btn-ghost text-danger" onClick={remove} disabled={busy}>Remove</button>
          </div>
        </div>
      ) : (
        <form onSubmit={save} className="grid gap-3">
          <label className="label sr-only" htmlFor="api-key">API key</label>
          <input
            id="api-key"
            type="password"
            className="input font-mono"
            placeholder="sk-ant-api03-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
          />
          {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy || !key}>{busy ? "Checking key…" : "Save and verify"}</button>
            {settings.hasApiKey && (
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function ModelCard({
  settings,
  models,
  error,
  onRetry,
  onChange,
}: {
  settings: Settings;
  models: Model[] | null;
  error: string | null;
  onRetry: () => void;
  onChange: (s: Settings) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function pick(model: string) {
    setBusy(true);
    setSaveError(null);
    try {
      onChange(await api<Settings>("/api/v1/settings", { method: "PATCH", body: JSON.stringify({ model }) }));
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="mb-1 font-semibold">Claude model</h2>
      <p className="mb-4 text-sm text-muted">
        Used for every AI feature: chat, literature reviews and writing. More capable models cost more per request.
      </p>
      {!settings.hasApiKey ? (
        <p className="text-sm text-muted">Add your API key first to see the models it can use.</p>
      ) : models === null ? (
        <div className="h-10 animate-pulse rounded-md bg-surface-2" />
      ) : error ? (
        <div className="flex items-center gap-3 text-sm text-danger">
          {error} <button className="btn-secondary" onClick={onRetry}>Retry</button>
        </div>
      ) : (
        <>
          <label className="label sr-only" htmlFor="model">Model</label>
          <select
            id="model"
            className="input"
            value={settings.model ?? ""}
            disabled={busy}
            onChange={(e) => pick(e.target.value)}
          >
            {!settings.model && <option value="">Select a model…</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.id})
              </option>
            ))}
          </select>
          {saveError && <p className="mt-2 text-sm text-danger">{saveError}</p>}
        </>
      )}
    </section>
  );
}

function CitationCard({
  settings,
  styles,
  onChange,
}: {
  settings: Settings;
  styles: { id: string; label: string }[];
  onChange: (s: Settings) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="card">
      <h2 className="mb-1 font-semibold">Default citation style</h2>
      <p className="mb-4 text-sm text-muted">Applied to new documents. You can change it per document.</p>
      <label className="label sr-only" htmlFor="style">Citation style</label>
      <select
        id="style"
        className="input"
        value={settings.citationStyle}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          try {
            onChange(
              await api<Settings>("/api/v1/settings", {
                method: "PATCH",
                body: JSON.stringify({ citationStyle: e.target.value }),
              }),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {styles.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
    </section>
  );
}
