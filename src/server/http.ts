import "server-only";
import { LibraryError } from "./library";

/** Turns known errors into JSON responses; rethrows the rest. */
export function errorResponse(err: unknown): Response {
  if (err instanceof LibraryError) return Response.json({ error: err.message }, { status: err.status });
  console.error(err);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
}
