import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '../account';
import { worker } from '../worker';
import { scheduledContact } from './scheduledContact.model';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';

export const schedule = pgTable(
  'schedule',
  {
    schedule_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    worker_id: uuid()
      .references(() => worker.worker_id)
      .notNull(),
    type: varchar({ length: 20 }).notNull().$type<EScheduleType>(),
    send_to: varchar({ length: 30 }).notNull().$type<EScheduleSendTo>(),
    message: text(),
    url: varchar({ length: 500 }),
    mimetype: varchar({ length: 100 }),
    duration: integer(),
    width: integer(),
    height: integer(),
    send_date: timestamp({
      mode: 'string',
      withTimezone: true,
    }).notNull(),
    status: varchar({ length: 20 })
      .notNull()
      .$type<EScheduleStatus>()
      .default(EScheduleStatus.pending),
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
    index('schedule_account_id_idx').on(table.account_id),
    index('schedule_worker_id_idx').on(table.worker_id),
    index('schedule_send_date_idx').on(table.send_date),
    index('schedule_status_idx').on(table.status),
    index('schedule_account_id_status_idx').on(table.account_id, table.status),
    index('schedule_status_send_date_idx').on(table.status, table.send_date),
    index('schedule_status_send_date_created_at_idx').on(
      table.status,
      table.send_date,
      table.created_at
    ),
  ]
);

export const scheduleRelations = relations(schedule, ({ one, many }) => ({
  sac: one(account, {
    fields: [schedule.account_id],
    references: [account.account_id],
  }),
  swr: one(worker, {
    fields: [schedule.worker_id],
    references: [worker.worker_id],
  }),
  scs: many(scheduledContact),
}));
