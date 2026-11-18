/**
 * Background worker: long-running jobs live here, outside the web process
 * (PDF ingestion, embeddings and literature-review agents in later phases).
 * Phase 1 ships the queue plumbing and a health-check job.
 */
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_NAME, type JobName } from "../src/server/queue-names";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

const handlers: Record<JobName, (job: Job) => Promise<unknown>> = {
  ping: async (job) => ({ pong: true, receivedAt: new Date().toISOString(), data: job.data }),
};

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const handler = handlers[job.name as JobName];
    if (!handler) throw new Error(`No handler for job "${job.name}"`);
    return handler(job);
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) },
);

worker.on("ready", async () => {
  console.info(`[worker] listening on queue "${QUEUE_NAME}"`);
  // Self-test so `docker compose logs worker` shows the pipeline works end to end.
  const q = new Queue(QUEUE_NAME, { connection });
  await q.add("ping", { from: "startup" }, { removeOnComplete: 100, removeOnFail: 100 });
  await q.close();
});
worker.on("completed", (job, result) => console.info(`[worker] ${job.name}#${job.id} done`, result));
worker.on("failed", (job, err) => console.error(`[worker] ${job?.name}#${job?.id} failed:`, err.message));

async function shutdown(signal: string) {
  console.info(`[worker] ${signal} received, draining…`);
  await worker.close();
  await connection.quit();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
