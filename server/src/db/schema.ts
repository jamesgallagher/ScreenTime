import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** docs/SPEC.md §6.1. More tables are added by CARD-010. */
export const families = pgTable('families', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  emergencyNumber: text('emergency_number').notNull().default('000'),
  parentCodeSecret: text('parent_code_secret').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
});
