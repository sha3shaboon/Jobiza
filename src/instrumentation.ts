/** Runs once when the server starts, before it handles requests. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.JOBIZA_DESKTOP !== "1") return;
  const { bootstrapDesktop } = await import("./server/desktop");
  await bootstrapDesktop();
}
