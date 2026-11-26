// Entry point for the app's server process (an Electron utility process).
// Adds a clean shutdown the main process can ask for, then starts Next.js.
// Windows has no SIGTERM, so the request arrives as a message instead.

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

require("./server.js");
