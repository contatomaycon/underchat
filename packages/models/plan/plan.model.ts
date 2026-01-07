import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  numeric,
  boolean,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { planItems, planAccount, planAccountExclusive } from '@core/models';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';

export const plan = pgTable(
  'plan',
  {
    plan_id: uuid().primaryKey().notNull(),
    name: varchar({ length: 50 }).notNull(),
    price: numeric({ precision: 10, scale: 2 }).notNull(),
    price_old: numeric({ precision: 10, scale: 2 }).notNull(),
    description: varchar({ length: 500 }),
    annual_discount: numeric({ precision: 5, scale: 2 }),
    icon: varchar({ length: 100 }),
    is_test: boolean().notNull().default(false),
    days_trial: integer(),
    status: varchar({ length: 20 })
      .notNull()
      .$type<EPlanStatus>()
      .default(EPlanStatus.active),
    is_exclusive: boolean().notNull().default(false),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp('deleted_at', { mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('plan_status_idx').on(table.status),
    index('plan_deleted_at_idx').on(table.deleted_at),
  ]
);

export const planRelations = relations(plan, ({ many }) => ({
  ppi: many(planItems),
  pac: many(planAccount),
  pae: many(planAccountExclusive),
}));
