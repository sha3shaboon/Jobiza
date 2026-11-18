import type { Metadata } from "next";
import { AskView } from "@/components/ask/ask-view";
import { listConversations } from "@/server/chat";
import { listPapers } from "@/server/library";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Ask" };

export default async function AskPage({ searchParams }: { searchParams: Promise<{ paper?: string }> }) {
  const { user } = await requireSession();
  const [{ paper }, conversations, papers] = await Promise.all([searchParams, listConversations(user.id), listPapers(user.id)]);
  const ready = papers.filter((p) => p.status === "ready");
  const initialScope = paper && ready.some((p) => p.id === paper) ? [paper] : [];
  return <AskView key={initialScope.join()} conversations={conversations} papers={ready} conversation={null} initialScope={initialScope} />;
}
