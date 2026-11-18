import type { Metadata } from "next";
import { ReviewsList } from "@/components/reviews/reviews-list";
import { listReviews } from "@/server/reviews";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Literature reviews" };

export default async function ReviewsPage() {
  const { user } = await requireSession();
  return <ReviewsList initialReviews={await listReviews(user.id)} />;
}
