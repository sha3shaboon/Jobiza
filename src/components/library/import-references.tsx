"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/client-api";

type Result = { added: number; skipped: number; truncated: boolean };

/** Import from a reference manager: a .bib/.ris/.json file, or a Zotero library. */
export function ImportReferences({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"file" | "zotero">("file");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [zotero, setZotero] = useState({ libraryType: "user", libraryId: "", apiKey: "", collectionKey: "" });

  const done = (r: Result) => {
    setMessage({
      ok: true,
      text: `Added ${r.added} ${r.added === 1 ? "reference" : "references"}${r.skipped ? `, skipped ${r.skipped} already in your library` : ""}${r.truncated ? " (the first 500)" : ""}. Open-access papers are fetched in the background.`,
    });
    onImported();
  };

  async function importFile(f: File) {
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", f);
      done(await api<Result>("/api/v1/papers/import-references", { method: "POST", body: form }));
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function importZotero(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      done(await api<Result>("/api/v1/papers/import-zotero", { method: "POST", body: JSON.stringify(zotero) }));
      setZotero((z) => ({ ...z, apiKey: "" }));
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Import references" className="mt-4">
      <button className="text-sm font-medium text-muted underline underline-offset-4 hover:text-text" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : "Import from Zotero, Mendeley or a .bib file"}
      </button>
      {open && (
        <div className="mt-3 rounded-[14px] border border-border p-5">
          <div role="tablist" className="mb-4 inline-flex rounded-[10px] bg-surface-2 p-1 text-sm">
            {(["file", "zotero"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`min-h-9 rounded-[8px] px-3 ${tab === t ? "bg-surface font-medium ring-1 ring-border" : "text-muted"}`}>
                {t === "file" ? "From a file" : "Connect Zotero"}
              </button>
            ))}
          </div>
          {tab === "file" ? (
            <div>
              <p className="text-sm text-muted">Export your library from Zotero, Mendeley, EndNote or JabRef as BibTeX (.bib), RIS (.ris) or CSL JSON, then choose the file.</p>
              <button className="btn-secondary mt-3" disabled={busy} onClick={() => file.current?.click()}>
                {busy ? "Importing…" : "Choose file"}
              </button>
              <input
                ref={file}
                type="file"
                accept=".bib,.bibtex,.ris,.json,application/json,application/x-bibtex"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          ) : (
            <form onSubmit={importZotero} className="grid gap-3 sm:grid-cols-2">
              <p className="text-sm text-muted sm:col-span-2">
                Create a read-only key at zotero.org/settings/keys. Your user ID is shown on the same page. The key is used for this import only and isn&apos;t stored.
              </p>
              <div>
                <label htmlFor="z-type" className="label">
                  Library
                </label>
                <select id="z-type" name="libraryType" className="input" value={zotero.libraryType} onChange={(e) => setZotero({ ...zotero, libraryType: e.target.value })}>
                  <option value="user">My library</option>
                  <option value="group">A group library</option>
                </select>
              </div>
              <div>
                <label htmlFor="z-id" className="label">
                  {zotero.libraryType === "user" ? "User ID" : "Group ID"}
                </label>
                <input id="z-id" name="libraryId" inputMode="numeric" required className="input" value={zotero.libraryId} onChange={(e) => setZotero({ ...zotero, libraryId: e.target.value })} autoComplete="off" />
              </div>
              <div>
                <label htmlFor="z-key" className="label">
                  API key
                </label>
                <input id="z-key" name="apiKey" type="password" required className="input" value={zotero.apiKey} onChange={(e) => setZotero({ ...zotero, apiKey: e.target.value })} autoComplete="off" spellCheck={false} />
              </div>
              <div>
                <label htmlFor="z-col" className="label">
                  Collection key (optional)
                </label>
                <input id="z-col" name="collectionKey" className="input" value={zotero.collectionKey} onChange={(e) => setZotero({ ...zotero, collectionKey: e.target.value.toUpperCase() })} autoComplete="off" spellCheck={false} placeholder="ABCD1234" />
              </div>
              <div className="sm:col-span-2">
                <button className="btn-primary" disabled={busy}>
                  {busy ? "Importing…" : "Import from Zotero"}
                </button>
              </div>
            </form>
          )}
          {message && (
            <p role={message.ok ? "status" : "alert"} className={`mt-4 rounded-[10px] px-3.5 py-2.5 text-sm ${message.ok ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger"}`}>
              {message.text}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
