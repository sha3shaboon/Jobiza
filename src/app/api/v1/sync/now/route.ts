import { syncAll, syncStatus } from "@/server/sync/engine";
import { syncSession } from "@/server/sync/http";

/** Sync with every paired device now. */
export async function POST() {
  const { error } = await syncSession();
  if (error) return error;
  const results = await syncAll();
  return Response.json({ results, ...(await syncStatus()) });
}
