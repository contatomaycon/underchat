import {
  integer,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { worker, workerWarmPool } from '@core/models';
import { relations } from 'drizzle-orm';

export const workerRuntime = pgTable(
  'worker_runtime',
  {
    worker_id: uuid()
      .primaryKey()
      .references(() => worker.worker_id)
      .notNull(),
    container_id: varchar({ length: 100 }),
    container_name: varchar({ length: 150 }),
    session_volume_name: varchar({ length: 150 }).notNull(),
    runtime_generation: integer().notNull().default(1),
    warm_pool_id: uuid().references(() => workerWarmPool.warm_pool_id),
    activated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
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
    index('worker_runtime_container_id_idx').on(table.container_id),
    index('worker_runtime_container_name_idx').on(table.container_name),
    index('worker_runtime_session_volume_name_idx').on(
      table.session_volume_name
    ),
    index('worker_runtime_warm_pool_id_idx').on(table.warm_pool_id),
  ]
);

export const workerRuntimeRelations = relations(workerRuntime, ({ one }) => ({
  wkr: one(worker, {
    fields: [workerRuntime.worker_id],
    references: [worker.worker_id],
  }),
  wwp: one(workerWarmPool, {
    fields: [workerRuntime.warm_pool_id],
    references: [workerWarmPool.warm_pool_id],
  }),
}));
