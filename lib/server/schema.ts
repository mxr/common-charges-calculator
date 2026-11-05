import { bigint, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
