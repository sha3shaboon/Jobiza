import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ───────────── Better Auth core tables ───────────── */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* ───────────── App tables ───────────── */

/**
 * Per-user preferences, including the user's own Anthropic API key
 * (bring-your-own-key). The key is stored AES-256-GCM encrypted; only
 * the last 4 characters are kept in clear text for display.
 */
export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  anthropicKeyCiphertext: text("anthropic_key_ciphertext"),
  anthropicKeyLast4: text("anthropic_key_last4"),
  anthropicKeyVerifiedAt: timestamp("anthropic_key_verified_at", { withTimezone: true }),
  model: text("model"),
  citationStyle: text("citation_style").notNull().default("apa"),
  ...timestamps,
});

/**
 * Workspaces own all research content (papers, reviews, documents).
 * Phase 1 creates exactly one personal workspace per user; sharing
 * later only needs new membership rows and UI.
 */
export const workspaceKind = pgEnum("workspace_kind", ["personal", "shared"]);
export const memberRole = pgEnum("member_role", ["owner", "editor", "viewer"]);

export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: workspaceKind("kind").notNull().default("personal"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  ...timestamps,
}, (t) => [
  uniqueIndex("workspace_one_personal_per_user").on(t.ownerId).where(sql`kind = 'personal'`),
]);

export const workspaceMember = pgTable(
  "workspace_member",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("owner"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

/* ───────────── Relations ───────────── */

export const userRelations = relations(user, ({ one, many }) => ({
  settings: one(userSettings, { fields: [user.id], references: [userSettings.userId] }),
  memberships: many(workspaceMember),
}));

export const workspaceRelations = relations(workspace, ({ many }) => ({
  members: many(workspaceMember),
}));

export const workspaceMemberRelations = relations(workspaceMember, ({ one }) => ({
  workspace: one(workspace, { fields: [workspaceMember.workspaceId], references: [workspace.id] }),
  user: one(user, { fields: [workspaceMember.userId], references: [user.id] }),
}));
