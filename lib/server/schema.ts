import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Budget } from "../types";

export const otpGate = pgTable("otp_gate", {
  // Lowercased, matched against user.email in the send.otp webhook.
  email: text().primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const otpSend = pgTable("otp_send", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  email: text().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
});

export const building = pgTable(
  "building",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    // A neon_auth user id.
    adminId: uuid("admin_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.adminId)],
);

export const project = pgTable(
  "project",
  {
    id: uuid().primaryKey().defaultRandom(),
    buildingId: uuid("building_id")
      .notNull()
      .references(() => building.id, { onDelete: "cascade" }),
    name: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.buildingId)],
);

export const budget = pgTable(
  "budget",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text().notNull(),
    // 0 means nothing is published.
    latestVersion: integer("latest_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.projectId)],
);

export const budgetDraft = pgTable(
  "budget_draft",
  {
    id: uuid().primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull(),
    name: text().notNull(),
    baseVersion: integer("base_version").notNull().default(0),
    revision: integer().notNull().default(0),
    content: jsonb().$type<Budget>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.budgetId)],
);

// A published snapshot. It never changes, and the primary key stops two publishes from taking one number.
export const budgetVersion = pgTable(
  "budget_version",
  {
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    // The version the draft started from. 0 means an empty budget.
    basedOn: integer("based_on").notNull(),
    note: text().notNull().default(""),
    content: jsonb().$type<Budget>().notNull(),
    publishedBy: uuid("published_by").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.budgetId, table.number] })],
);

export const ROLES = ["viewer", "editor"] as const;

// A building admin has full access without a row here.
export const budgetMember = pgTable(
  "budget_member",
  {
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    // A neon_auth user id.
    userId: uuid("user_id").notNull(),
    role: text({ enum: ROLES }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.budgetId, table.userId] }),
    index().on(table.userId),
    check("budget_member_role_check", sql`${table.role} in ('viewer', 'editor')`),
  ],
);

// An invite link. Only a hash of its token is stored, so the link is shown once, when it is made.
export const budgetInvite = pgTable(
  "budget_invite",
  {
    id: uuid().primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => budget.id, { onDelete: "cascade" }),
    role: text({ enum: ROLES }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: uuid("created_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedBy: uuid("accepted_by"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (table) => [index().on(table.budgetId), check("budget_invite_role_check", sql`${table.role} in ('viewer', 'editor')`)],
);
