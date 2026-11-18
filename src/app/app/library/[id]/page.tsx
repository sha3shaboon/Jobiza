import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaperView } from "@/components/library/paper-view";
import { getOwnedPaper, LibraryError, toSummary } from "@/server/library";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Paper" };

export default async function PaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; hl?: string }>;
}) {
  const { user } = await requireSession();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  let paper;
  try {
    paper = await getOwnedPaper(user.id, id);
  } catch (err) {
    if (err instanceof LibraryError) notFound();
    throw err;
  }
  const page = Math.max(1, Number(sp.page) || 1);
  return (
    <PaperView
      paper={{ ...toSummary(paper), abstract: paper.abstract }}
      initialPage={page}
      highlight={typeof sp.hl === "string" ? sp.hl.slice(0, 2000) : ""}
    />
  );
}
