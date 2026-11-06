import { pgSchema, text, uuid } from "drizzle-orm/pg-core";

// Neon Auth owns this table. It sits outside schema.ts so that migrations never touch it.
export const authUser = pgSchema("neon_auth").table("user", {
  id: uuid().primaryKey(),
  email: text().notNull(),
});
