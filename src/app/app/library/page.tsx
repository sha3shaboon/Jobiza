import type { Metadata } from "next";
import { LibraryView } from "@/components/library/library-view";
import { listPapers } from "@/server/library";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage() {
  const { user } = await requireSession();
  const papers = await listPapers(user.id);
  return <LibraryView initialPapers={papers} />;
}
