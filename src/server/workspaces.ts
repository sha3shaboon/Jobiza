import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/db";

/** Creates the user's personal workspace + settings row (idempotent). */
export async function ensurePersonalWorkspace(userId: string, name: string) {
  const d = db();
  await d.transaction(async (tx) => {
    const existing = await tx.query.workspace.findFirst({
      where: and(eq(schema.workspace.ownerId, userId), eq(schema.workspace.kind, "personal")),
    });
    if (!existing) {
      const id = randomUUID();
      await tx.insert(schema.workspace).values({ id, name: `${name.split(" ")[0] || "My"}'s library`, ownerId: userId });
      await tx.insert(schema.workspaceMember).values({ workspaceId: id, userId, role: "owner" });
    }
    await tx.insert(schema.userSettings).values({ userId }).onConflictDoNothing();
  });
}

export async function getPersonalWorkspace(userId: string) {
  return db().query.workspace.findFirst({
    where: and(eq(schema.workspace.ownerId, userId), eq(schema.workspace.kind, "personal")),
  });
}
