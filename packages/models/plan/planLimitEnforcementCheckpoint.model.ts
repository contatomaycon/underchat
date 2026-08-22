import { account } from '@core/models';
import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const planLimitEnforcementCheckpoint = pgTable(
  'plan_limit_enforcement_checkpoint',
  {
    account_id: uuid()
      .primaryKey()
      .references(() => account.account_id)
      .notNull(),
    last_checked_at: timestamp('last_checked_at', {
      mode: 'string',
      withTimezone: true,
    }),
    last_started_at: timestamp('last_started_at', {
      mode: 'string',
      withTimezone: true,
    }),
    last_finished_at: timestamp('last_finished_at', {
      mode: 'string',
      withTimezone: true,
    }),
    last_error: text('last_error'),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('plan_limit_checkpoint_last_checked_at_idx').on(
      table.last_checked_at
    ),
    index('plan_limit_checkpoint_last_started_at_idx').on(
      table.last_started_at
    ),
  ]
);

export const planLimitEnforcementCheckpointRelations = relations(
  planLimitEnforcementCheckpoint,
  ({ one }) => ({
    acc: one(account, {
      fields: [planLimitEnforcementCheckpoint.account_id],
      references: [account.account_id],
    }),
  })
);
