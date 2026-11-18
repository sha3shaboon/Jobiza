export const QUEUE_NAME = "jobiza";
export type JobName = "ping" | "ingest-paper" | "review-step";
export type IngestJob = { paperId: string };
export type ReviewStepJob = { reviewId: string; step: "run" | "search" | "ai-screen" | "retrieve" | "extract" | "synthesize" };
