import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
