import type { Metadata } from "next";
import { DocumentList } from "@/components/writing/document-list";
import { listDocuments } from "@/server/documents";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Writing" };

export default async function WritingPage() {
  const { user } = await requireSession();
  return <DocumentList documents={await listDocuments(user.id)} />;
}
