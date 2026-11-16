import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
});
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  accessHash: text('access_hash').notNull().unique(),
  refreshHash: text('refresh_hash').notNull().unique(),
  accessExpires: integer('access_expires').notNull(),
  refreshExpires: integer('refresh_expires').notNull(),
});
