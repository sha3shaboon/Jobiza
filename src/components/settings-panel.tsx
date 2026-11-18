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
    <div className="mt-10">
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
    <SettingRow
      id="api-key-title"
      title="Anthropic API key"
      status={
        settings.hasApiKey ? (
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">Connected</span>
        ) : null
      }
      description={
        <>
          Create one in the{" "}
          <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer" className="link text-text">
            Claude Console
          </a>
          . Checking it with Anthropic costs nothing, and it&apos;s stored encrypted.
        </>
      }
    >
      {settings.hasApiKey && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-surface-2 px-4 py-3">
          <div>
            <span translate="no" className="tabular-nums">sk-ant-…{settings.apiKeyLast4}</span>
            {settings.apiKeyVerifiedAt && (
              <span className="ml-2 text-sm text-muted">Verified {dateFormat.format(new Date(settings.apiKeyVerifiedAt))}</span>
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
            name="anthropic-api-key"
            type="password"
            className="input"
            placeholder="sk-ant-api03-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
          />
          {error && <p className="rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy || !key}>{busy ? "Checking key…" : "Save and verify key"}</button>
            {settings.hasApiKey && (
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            )}
          </div>
        </form>
      )}
    </SettingRow>
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
    <SettingRow
      id="model-title"
      title="Claude model"
      description="Answers questions, runs literature reviews and checks your writing. More capable models cost more per request."
    >
      {!settings.hasApiKey ? (
        <p className="text-muted">Add your API key first to see the models it can use.</p>
      ) : models === null ? (
        <div className="h-11 animate-pulse rounded-[10px] bg-surface-2" aria-label="Loading models…" />
      ) : error ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-danger" role="alert">
          {error}
          <button className="btn-secondary" onClick={onRetry}>
            Try again
          </button>
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
          {saveError && (
            <p className="mt-2 text-sm text-danger" role="alert">
              {saveError}
            </p>
          )}
        </>
      )}
    </SettingRow>
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
    <SettingRow
      id="style-title"
      title="Default citation style"
      description="Used for new documents. You can change it in each document."
    >
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
    </SettingRow>
  );
}

/** One setting: explanation in the margin column, controls beside it. */
function SettingRow({
  id,
  title,
  status,
  description,
  children,
}: {
  id: string;
  title: string;
  status?: React.ReactNode;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-4 border-t border-border py-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={id} className="text-lg font-medium">
            {title}
          </h2>
          {status}
        </div>
        <div className="mt-1.5 text-sm leading-relaxed text-muted">{description}</div>
      </div>
      <div className="min-w-0 lg:pt-1">{children}</div>
    </section>
  );
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
