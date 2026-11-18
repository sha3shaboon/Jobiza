import { apiSession } from "@/server/session";
import { getSettings } from "@/server/settings";
import { getPersonalWorkspace } from "@/server/workspaces";

export async function GET() {
  const { session, error } = await apiSession();
  if (error) return error;
  const [settings, workspace] = await Promise.all([
    getSettings(session.user.id),
    getPersonalWorkspace(session.user.id),
  ]);
  return Response.json({
    user: { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image },
    workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
    settings,
  });
}
