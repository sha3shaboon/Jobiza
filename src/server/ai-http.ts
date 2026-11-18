import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { errorResponse } from "./http";
import { describeApiError, ReviewAiError } from "./review-ai";

/** Claude errors become readable 400s; everything else goes through errorResponse. */
export function aiErrorResponse(err: unknown): Response {
  if (err instanceof ReviewAiError || err instanceof Anthropic.APIError) {
    return Response.json({ error: describeApiError(err) }, { status: 400 });
  }
  return errorResponse(err);
}
