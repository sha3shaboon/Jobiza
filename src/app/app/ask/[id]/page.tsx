import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AskView } from "@/components/ask/ask-view";
import { getConversation, listConversations } from "@/server/chat";
import { LibraryError, listPapers } from "@/server/library";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Ask" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  const { id } = await params;
  let conversation;
  try {
    conversation = await getConversation(user.id, id);
  } catch (err) {
    if (err instanceof LibraryError) notFound();
    throw err;
  }
  const [conversations, papers] = await Promise.all([listConversations(user.id), listPapers(user.id)]);
  return (
    <AskView
      key={id}
      conversations={conversations}
      papers={papers.filter((p) => p.status === "ready")}
      conversation={conversation}
      initialScope={conversation.scopePaperIds}
    />
  );
}
