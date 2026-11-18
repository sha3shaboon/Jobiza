import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WritingEditor } from "@/components/writing/editor";
import type { DocNode } from "@/lib/writing/doc";
import { citablePapers, ownedDocument } from "@/server/documents";
import { LibraryError } from "@/server/library";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Writing" };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  const { id } = await params;
  let doc;
  try {
    doc = await ownedDocument(user.id, id);
  } catch (err) {
    if (err instanceof LibraryError) notFound();
    throw err;
  }
  const papers = (await citablePapers(user.id)).map((p) => ({
    id: p.id,
    title: p.title,
    authors: p.authors.map((a) => a.name),
    year: p.year,
    status: p.status,
  }));
  return (
    <WritingEditor
      doc={{
        id: doc.id,
        title: doc.title,
        content: doc.content as DocNode,
        citationStyle: doc.citationStyle,
        checks: doc.checks,
        checkedAt: doc.checkedAt?.toISOString() ?? null,
      }}
      papers={papers}
    />
  );
}
