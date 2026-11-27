// Entry point for the local app's server process: an Electron utility process on
// desktop, or a Node child process on Android. Adds a clean shutdown the app
// can ask for, then starts Next.js. Windows has no SIGTERM, so there the request
// arrives as a message instead.

let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    // Flush the embedded database to disk (created by src/db/index.ts).
    const client = globalThis.__jobizaPglite;
    if (client && !client.closed) await client.close();
  } catch (err) {
    console.error("[desktop] error while closing the database:", err);
  }
  process.exit(0);
}

process.parentPort?.on("message", (e) => {
  if (e.data === "shutdown") void shutdown();
});
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// Android signals this process by its id, and stops a leftover one before starting another.
if (process.env.JOBIZA_PID_FILE) require("node:fs").writeFileSync(process.env.JOBIZA_PID_FILE, String(process.pid));

require("./server.js");
