import type { Metadata } from "next";
import { ProposalWizard } from "@/components/writing/proposal-wizard";
import { listPapers } from "@/server/library";
import { listReviews } from "@/server/reviews";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "New research proposal" };

export default async function NewProposalPage({ searchParams }: { searchParams: Promise<{ review?: string }> }) {
  const { user } = await requireSession();
  const [{ review }, reviews, papers] = await Promise.all([searchParams, listReviews(user.id), listPapers(user.id)]);
  return (
    <ProposalWizard
      reviews={reviews.map((r) => ({ id: r.id, title: r.title, question: r.question, included: r.included }))}
      papers={papers.filter((p) => p.status === "ready")}
      initialReviewId={reviews.some((r) => r.id === review) ? review! : null}
    />
  );
}
