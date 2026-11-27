import { forgetPeer } from "@/server/sync/engine";
import { syncSession } from "@/server/sync/http";

/** Stop syncing with a device. Its data already here stays. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { error } = await syncSession();
  if (error) return error;
  await forgetPeer((await ctx.params).id);
  return new Response(null, { status: 204 });
}
