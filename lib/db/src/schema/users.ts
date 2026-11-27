import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** scrypt hash, `salt:hash` in hex. */
  passwordHash: text("password_hash"),
  displayName: text("display_name").notNull(),
  workspace: text("workspace").notNull().default("client"),
  role: text("role").notNull().default("individual"),
  organisation: text("organisation"),
  onboarded: boolean("onboarded").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;

/** Sign-in sessions; only a SHA-256 of the cookie token is stored. */
export const sessionsTable = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
