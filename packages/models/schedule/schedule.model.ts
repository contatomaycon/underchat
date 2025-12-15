import { pgTable, uuid, timestamp, varchar, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '../account';
import { worker } from '../worker';
import { scheduledContact } from './scheduledContact.model';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';

export const schedule = pgTable('schedule', {
  schedule_id: uuid().primaryKey().notNull(),
  account_id: uuid()
    .references(() => account.account_id)
    .notNull(),
  worker_id: uuid()
    .references(() => worker.worker_id)
    .notNull(),
  scheduled_contact_id: uuid().references(
    () => scheduledContact.scheduled_contact_id
  ),
  type: varchar({ length: 20 }).notNull().$type<EScheduleType>(),
  send_to: varchar({ length: 30 }).notNull().$type<EScheduleSendTo>(),
  message: text(),
  url: varchar({ length: 500 }),
  send_date: timestamp({
    mode: 'string',
    withTimezone: true,
  }).notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const scheduleRelations = relations(schedule, ({ one }) => ({
  sac: one(account, {
    fields: [schedule.account_id],
    references: [account.account_id],
  }),
  swr: one(worker, {
    fields: [schedule.worker_id],
    references: [worker.worker_id],
  }),
  ssc: one(scheduledContact, {
    fields: [schedule.scheduled_contact_id],
    references: [scheduledContact.scheduled_contact_id],
  }),
}));
