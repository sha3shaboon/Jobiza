import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewView } from "@/components/reviews/review-view";
import { LibraryError } from "@/server/library";
import { getReviewDetail } from "@/server/reviews";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Literature review" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  const { id } = await params;
  let detail;
  try {
    detail = await getReviewDetail(user.id, id);
  } catch (err) {
    if (err instanceof LibraryError) notFound();
    throw err;
  }
  return <ReviewView initial={detail} />;
}
