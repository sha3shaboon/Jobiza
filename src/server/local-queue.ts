import "server-only";
import type { IngestJob, ReviewStepJob } from "./queue-names";

/**
 * Desktop app job runner: the same jobs as the BullMQ worker, run inside the
 * app's own process (there is no Redis or separate worker on a desktop).
 * Jobs aren't persisted here; on startup the app re-queues papers that were
 * still processing (see desktop-bootstrap.ts).
 */
type Job = { name: "ingest-paper"; data: IngestJob; attempts: number } | { name: "review-step"; data: ReviewStepJob; attempts: number };

const CONCURRENCY = 2;
const RETRY_DELAY_MS = 10_000;

const g = globalThis as unknown as { __jobizaLocalQueue?: { pending: Job[]; running: number } };
const state = (g.__jobizaLocalQueue ??= { pending: [], running: 0 });

async function run(job: Job) {
  // Imported lazily: these modules import the library, which imports the queue.
  if (job.name === "ingest-paper") {
    const { ingestPaper } = await import("./ingest");
    await ingestPaper(job.data.paperId);
  } else {
    const { runReviewStep } = await import("./reviews");
    await runReviewStep(job.data.reviewId, job.data.step);
  }
}

function pump() {
  while (state.running < CONCURRENCY && state.pending.length) {
    const job = state.pending.shift()!;
    state.running++;
    run(job)
      .then(() => console.info(`[jobs] ${job.name} done`))
      .catch((err: Error) => {
        console.error(`[jobs] ${job.name} failed:`, err.message);
        // Same policy as the server worker: ingestion retries once, review steps record their own failures.
        if (job.name === "ingest-paper" && job.attempts < 2) setTimeout(() => add({ ...job, attempts: job.attempts + 1 }), RETRY_DELAY_MS);
      })
      .finally(() => {
        state.running--;
        pump();
      });
  }
}

function add(job: Job) {
  state.pending.push(job);
  // Let the request that queued the job respond first.
  setImmediate(pump);
}

export function addLocalIngest(data: IngestJob) {
  add({ name: "ingest-paper", data, attempts: 1 });
}

export function addLocalReviewStep(data: ReviewStepJob) {
  add({ name: "review-step", data, attempts: 1 });
}
