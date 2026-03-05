import { relations } from 'drizzle-orm';
import {
  index,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './user.model';

export const userAttendanceHoursRule = pgTable(
  'user_attendance_hours_rule',
  {
    user_id: uuid()
      .notNull()
      .references(() => user.user_id, { onDelete: 'cascade' }),
    weekday: varchar({ length: 20 }).notNull(),
    start_time: varchar({ length: 5 }).notNull(),
    end_time: varchar({ length: 5 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.user_id, table.weekday, table.start_time, table.end_time],
      name: 'user_attendance_hours_rule_user_id_weekday_start_time_end_time_pk',
    }),
    index('user_attendance_hours_rule_user_id_idx').on(table.user_id),
    index('user_attendance_hours_rule_user_id_weekday_idx').on(
      table.user_id,
      table.weekday
    ),
  ]
);

export const userAttendanceHoursRuleRelations = relations(
  userAttendanceHoursRule,
  ({ one }) => ({
    user: one(user, {
      fields: [userAttendanceHoursRule.user_id],
      references: [user.user_id],
    }),
  })
);
