import { z } from "zod";
import { errorResponse } from "@/server/http";
import { syncStatus, updateDevice } from "@/server/sync/engine";
import { syncSession } from "@/server/sync/http";

/** This device and the devices it syncs with. */
export async function GET() {
  const { error } = await syncSession();
  if (error) return error;
  return Response.json(await syncStatus());
}

const body = z.object({ name: z.string().trim().min(1).max(60).optional(), enabled: z.boolean().optional() });

/** Rename this device, or turn sync on or off. */
export async function PATCH(req: Request) {
  const { error } = await syncSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the device a name." }, { status: 400 });
  try {
    await updateDevice(parsed.data);
    return Response.json(await syncStatus());
  } catch (err) {
    return errorResponse(err);
  }
}
