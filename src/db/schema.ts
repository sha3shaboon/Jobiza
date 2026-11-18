import { relations, sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** Embedding size of the local model (bge-small-en-v1.5). */
export const EMBEDDING_DIMENSIONS = 384;

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

/* ───────────── Library ───────────── */

export const paperSource = pgEnum("paper_source", ["upload", "doi", "url"]);
export const paperStatus = pgEnum("paper_status", ["queued", "processing", "ready", "failed"]);

export type PaperAuthor = { name: string };

/** A source in a workspace's library: an uploaded PDF, a DOI import or a web article. */
export const paper = pgTable(
  "paper",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
    source: paperSource("source").notNull(),
    status: paperStatus("status").notNull().default("queued"),
    statusDetail: text("status_detail"),
    title: text("title").notNull(),
    authors: jsonb("authors").$type<PaperAuthor[]>().notNull().default([]),
    year: integer("year"),
    venue: text("venue"),
    doi: text("doi"),
    url: text("url"),
    abstract: text("abstract"),
    /** Storage key of the original PDF, when there is one. */
    fileKey: text("file_key"),
    fileName: text("file_name"),
    pageCount: integer("page_count"),
    /** True when there was no full text, only metadata and abstract. */
    metadataOnly: boolean("metadata_only").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("paper_workspace_idx").on(t.workspaceId, t.createdAt),
    uniqueIndex("paper_workspace_doi_idx").on(t.workspaceId, t.doi).where(sql`doi is not null`),
  ],
);

/** Extracted text of each page (page 1 is the first page). */
export const paperPage = pgTable(
  "paper_page",
  {
    paperId: text("paper_id")
      .notNull()
      .references(() => paper.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    text: text("text").notNull(),
    /** "text" from the PDF text layer, "ocr" when Claude read a scanned page, "web" for articles. */
    method: text("method").notNull().default("text"),
  },
  (t) => [primaryKey({ columns: [t.paperId, t.pageNumber] })],
);

/** Retrieval unit: a passage within one page, with its embedding and full-text vector. */
export const chunk = pgTable(
  "chunk",
  {
    id: text("id").primaryKey(),
    paperId: text("paper_id")
      .notNull()
      .references(() => paper.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(sql`to_tsvector('english', text)`),
  },
  (t) => [
    index("chunk_paper_idx").on(t.paperId, t.chunkIndex),
    index("chunk_workspace_idx").on(t.workspaceId),
    index("chunk_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("chunk_tsv_idx").using("gin", t.tsv),
  ],
);

/* ───────────── Chat ───────────── */

export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New question"),
    /** Paper ids the conversation is limited to; empty means the whole library. */
    scopePaperIds: jsonb("scope_paper_ids").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("conversation_user_idx").on(t.userId, t.updatedAt)],
);

/** A citation attached to a span of an assistant answer. */
export type MessageCitation = {
  /** Character range in the message text that this citation supports. */
  start: number;
  end: number;
  paperId: string;
  paperTitle: string;
  pageNumber: number;
  /** "page" for PDFs, "section" for web articles. */
  locator?: "page" | "section";
  chunkId: string;
  citedText: string;
};

export const messageRole = pgEnum("message_role", ["user", "assistant"]);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<MessageCitation[]>().notNull().default([]),
    model: text("model"),
    /** Set when generation failed or was cut short, so the UI can say so. */
    error: text("error"),
    ...timestamps,
  },
  (t) => [index("message_conversation_idx").on(t.conversationId, t.createdAt)],
);

/* ───────────── Literature reviews ───────────── */

export const reviewMode = pgEnum("review_mode", ["agentic", "screening"]);
export const reviewStatus = pgEnum("review_status", [
  "draft",
  "searching",
  "screening",
  "retrieving",
  "extracting",
  "synthesizing",
  "ready",
  "failed",
]);

export type ReviewCriteria = { include: string[]; exclude: string[]; yearFrom?: number; yearTo?: number };
/** PRISMA identification counts, written when a search runs. */
export type ReviewCounts = {
  identified: Record<string, number>;
  duplicates: number;
  unavailable: { source: string; reason: string }[];
};

export const review = pgTable(
  "review",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    question: text("question").notNull(),
    mode: reviewMode("mode").notNull(),
    status: reviewStatus("status").notNull().default("draft"),
    statusDetail: text("status_detail"),
    criteria: jsonb("criteria").$type<ReviewCriteria>().notNull().default({ include: [], exclude: [] }),
    queries: jsonb("queries").$type<string[]>().notNull().default([]),
    sources: jsonb("sources").$type<string[]>().notNull().default(["openalex", "semantic_scholar", "arxiv", "pubmed"]),
    matrixColumns: jsonb("matrix_columns").$type<string[]>().notNull().default([]),
    counts: jsonb("counts").$type<ReviewCounts>(),
    synthesis: text("synthesis"),
    synthesisCitations: jsonb("synthesis_citations").$type<MessageCitation[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("review_user_idx").on(t.userId, t.updatedAt)],
);

export const screeningDecision = pgEnum("screening_decision", ["pending", "included", "excluded"]);
export const decisionBy = pgEnum("decision_by", ["ai", "user"]);
export const fullTextStatus = pgEnum("full_text_status", ["not_requested", "pending", "retrieved", "abstract_only", "failed"]);

export type AiScreening = { decision: "include" | "exclude"; reason: string; relevance: number };
export type MatrixCell = { value: string; page?: number };

/** One unique work found by a review's searches. */
export const reviewRecord = pgTable(
  "review_record",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => review.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    authors: jsonb("authors").$type<string[]>().notNull().default([]),
    year: integer("year"),
    venue: text("venue"),
    abstract: text("abstract"),
    doi: text("doi"),
    pmid: text("pmid"),
    arxivId: text("arxiv_id"),
    url: text("url"),
    openAccessPdfUrl: text("open_access_pdf_url"),
    citationCount: integer("citation_count"),
    sources: jsonb("sources").$type<string[]>().notNull().default([]),
    rank: integer("rank").notNull().default(0),
    screening: screeningDecision("screening").notNull().default("pending"),
    exclusionReason: text("exclusion_reason"),
    decidedBy: decisionBy("decided_by"),
    ai: jsonb("ai").$type<AiScreening>(),
    fullText: fullTextStatus("full_text").notNull().default("not_requested"),
    paperId: text("paper_id").references(() => paper.id, { onDelete: "set null" }),
    matrix: jsonb("matrix").$type<Record<string, MatrixCell>>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("review_record_key_idx").on(t.reviewId, t.key),
    index("review_record_screening_idx").on(t.reviewId, t.screening),
  ],
);

/** Activity log: what the review did and decided, in order (the PRISMA audit trail). */
export const reviewEvent = pgTable(
  "review_event",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => review.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("review_event_review_idx").on(t.reviewId, t.createdAt)],
);

/* ───────────── Relations ───────────── */

export const userRelations = relations(user, ({ one, many }) => ({
  settings: one(userSettings, { fields: [user.id], references: [userSettings.userId] }),
  memberships: many(workspaceMember),
}));

export const workspaceRelations = relations(workspace, ({ many }) => ({
  members: many(workspaceMember),
  papers: many(paper),
}));

export const paperRelations = relations(paper, ({ one, many }) => ({
  workspace: one(workspace, { fields: [paper.workspaceId], references: [workspace.id] }),
  pages: many(paperPage),
  chunks: many(chunk),
}));

export const paperPageRelations = relations(paperPage, ({ one }) => ({
  paper: one(paper, { fields: [paperPage.paperId], references: [paper.id] }),
}));

export const chunkRelations = relations(chunk, ({ one }) => ({
  paper: one(paper, { fields: [chunk.paperId], references: [paper.id] }),
}));

export const conversationRelations = relations(conversation, ({ many }) => ({
  messages: many(message),
}));

export const messageRelations = relations(message, ({ one }) => ({
  conversation: one(conversation, { fields: [message.conversationId], references: [conversation.id] }),
}));

export const workspaceMemberRelations = relations(workspaceMember, ({ one }) => ({
  workspace: one(workspace, { fields: [workspaceMember.workspaceId], references: [workspace.id] }),
  user: one(user, { fields: [workspaceMember.userId], references: [user.id] }),
}));
