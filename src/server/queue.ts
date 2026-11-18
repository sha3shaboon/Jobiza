import "server-only";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";
import { QUEUE_NAME, type IngestJob, type ReviewStepJob } from "./queue-names";

const g = globalThis as unknown as { __jobizaQueue?: Queue };

function queue(): Queue {
  if (!g.__jobizaQueue) {
    const connection = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null });
    g.__jobizaQueue = new Queue(QUEUE_NAME, { connection });
  }
  return g.__jobizaQueue;
}

export async function enqueueIngest(paperId: string) {
  const data: IngestJob = { paperId };
  await queue().add("ingest-paper", data, {
    jobId: `ingest-${paperId}-${Date.now()}`,
    attempts: 2,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 500,
    removeOnFail: 500,
  });
}

export async function enqueueReviewStep(reviewId: string, step: ReviewStepJob["step"]) {
  const data: ReviewStepJob = { reviewId, step };
  await queue().add("review-step", data, {
    jobId: `review-${reviewId}-${step}-${Date.now()}`,
    attempts: 1, // steps record their own failures; the user retries from the UI
    removeOnComplete: 500,
    removeOnFail: 500,
  });
}
