import { offerStatus } from "@/server/sync/engine";
import { syncSession } from "@/server/sync/http";

/** Whether another device has used this invitation yet. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await syncSession();
  if (error) return error;
  return Response.json(await offerStatus((await ctx.params).id));
}
