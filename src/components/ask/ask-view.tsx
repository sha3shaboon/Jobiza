"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MessageCitation } from "@/db/schema";
import { api } from "@/lib/client-api";
import type { ConversationSummary } from "@/server/chat";
import type { PaperSummary } from "@/server/library";
import { Answer } from "./answer";
import { Composer } from "./composer";
import { ScopePicker } from "./scope-picker";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: MessageCitation[];
  error: string | null;
  pending?: boolean;
};

type Conversation = ConversationSummary & { messages: (Message & { createdAt: string })[] };

const SUGGESTIONS = [
  "Summarise the main findings",
  "What methods did these studies use?",
  "Where do the sources disagree?",
  "What are the limitations the authors mention?",
];

/** Reads a Server-Sent Events response, calling `onEvent` for each JSON payload. */
async function readEvents(res: Response, onEvent: (e: { type: string } & Record<string, unknown>) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = raw.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

export function AskView({
  conversations: initialConversations,
  papers,
  conversation,
  initialScope,
}: {
  conversations: ConversationSummary[];
  papers: PaperSummary[];
  conversation: Conversation | null;
  initialScope: string[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState(conversation?.id ?? null);
  const [messages, setMessages] = useState<Message[]>(conversation?.messages ?? []);
  const [scope, setScope] = useState<string[]>(initialScope);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function changeScope(next: string[]) {
    setScope(next);
    if (conversationId) {
      await api(`/api/v1/conversations/${conversationId}`, { method: "PATCH", body: JSON.stringify({ scopePaperIds: next }) }).catch(() => undefined);
    }
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || streaming) return;
    setDraft("");
    setStreaming(true);
    const assistantId = `pending-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: `q-${Date.now()}`, role: "user", content: q, citations: [], error: null },
      { id: assistantId, role: "assistant", content: "", citations: [], error: null, pending: true },
    ]);
    const patchAssistant = (fn: (m: Message) => Message) =>
      setMessages((list) => list.map((m) => (m.id === assistantId ? fn(m) : m)));

    try {
      let id = conversationId;
      if (!id) {
        const { conversation: created } = await api<{ conversation: ConversationSummary }>("/api/v1/conversations", {
          method: "POST",
          body: JSON.stringify({ scopePaperIds: scope }),
        });
        id = created.id;
        setConversationId(id);
        setConversations((list) => [{ ...created, title: q.slice(0, 80) }, ...list]);
        window.history.replaceState(null, "", `/app/ask/${id}`);
      } else {
        setConversations((list) => {
          const current = list.find((c) => c.id === id);
          return current ? [current, ...list.filter((c) => c.id !== id)] : list;
        });
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const res = await fetch(`/api/v1/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't send your question.");
      }
      await readEvents(res, (e) => {
        if (e.type === "text") patchAssistant((m) => ({ ...m, content: m.content + (e.text as string) }));
        if (e.type === "done") {
          const msg = e.message as { id: string; content: string; citations: MessageCitation[]; error: string | null };
          patchAssistant(() => ({ ...msg, role: "assistant", pending: false }));
        }
        if (e.type === "error") patchAssistant((m) => ({ ...m, pending: false, error: e.error as string }));
      });
    } catch (err) {
      const aborted = (err as Error).name === "AbortError";
      patchAssistant((m) => ({ ...m, pending: false, error: aborted ? "Stopped." : (err as Error).message }));
    } finally {
      abortRef.current = null;
      setStreaming(false);
      patchAssistant((m) => ({ ...m, pending: false }));
    }
  }

  const noPapers = papers.length === 0;

  return (
    <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside aria-label="Your questions" className="hidden min-w-0 lg:block">
        <Link href="/app/ask" className="btn-primary w-full">
          New question
        </Link>
        <nav className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-muted">Earlier questions</h2>
          {conversations.length === 0 ? (
            <p className="text-sm text-muted">Your questions will be listed here.</p>
          ) : (
            <ul className="grid gap-0.5">
              {conversations.map((c) => (
                <li key={c.id} className="min-w-0">
                  <Link
                    href={`/app/ask/${c.id}`}
                    aria-current={c.id === conversationId ? "page" : undefined}
                    className={`block truncate rounded-[8px] px-3 py-2 text-sm ${c.id === conversationId ? "bg-surface-2 font-medium" : "text-muted hover:bg-surface-2 hover:text-text"}`}
                  >
                    {c.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>

      <section className="flex min-h-[calc(100vh-5rem)] min-w-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-[-0.02em]">Ask</h1>
          <div className="flex items-center gap-2">
            <Link href="/app/ask" className="btn-ghost min-h-10 px-3 text-sm lg:hidden">
              New
            </Link>
            <ScopePicker papers={papers} value={scope} onChange={changeScope} />
          </div>
        </div>

        <div className="flex-1 py-6">
          {messages.length === 0 ? (
            <EmptyState noPapers={noPapers} onPick={(s) => setDraft(s)} />
          ) : (
            <ol className="grid gap-10">
              {messages.map((m) =>
                m.role === "user" ? (
                  <li key={m.id} className="max-w-[40rem]">
                    <p className="text-sm text-muted">You asked</p>
                    <p className="mt-1 text-lg font-medium whitespace-pre-wrap">{m.content}</p>
                  </li>
                ) : (
                  <li key={m.id}>
                    <Answer content={m.content} citations={m.citations} pending={Boolean(m.pending)} error={m.error} />
                  </li>
                ),
              )}
            </ol>
          )}
          <div ref={endRef} />
        </div>

        <div className="sticky bottom-0 -mx-4 border-t border-border bg-bg/95 px-4 pt-3 pb-4 backdrop-blur sm:-mx-10 sm:px-10">
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={() => void ask(draft)}
            onStop={() => abortRef.current?.abort()}
            streaming={streaming}
            disabled={noPapers}
            placeholder={noPapers ? "Add a paper to your library first…" : "Ask a question about your papers…"}
          />
        </div>
      </section>
    </div>
  );
}

function EmptyState({ noPapers, onPick }: { noPapers: boolean; onPick: (s: string) => void }) {
  if (noPapers) {
    return (
      <div className="flex flex-col items-start gap-4 py-10 sm:flex-row sm:items-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration */}
        <img src="/illustrations/sprout-pot.svg" alt="" width={220} height={280} className="h-auto w-28" />
        <div>
          <p className="text-lg font-medium">Add papers to ask about</p>
          <p className="mt-1 max-w-md text-muted">Jobiza answers only from your library, so every answer can cite the page.</p>
          <Link href="/app/library" className="btn-primary mt-4">
            Go to your library
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[40rem] py-6">
      <p className="text-lg text-muted">Ask anything about your papers. Every claim in the answer links to the page it came from.</p>
      <ul className="mt-6 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button type="button" onClick={() => onPick(s)} className="btn-secondary min-h-10 px-4 text-sm">
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
