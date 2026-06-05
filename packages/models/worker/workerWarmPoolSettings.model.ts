import {
  boolean,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const workerWarmPoolSettings = pgTable('worker_warm_pool_settings', {
  settings_id: varchar({ length: 30 }).primaryKey().notNull(),
  warmup_enabled: boolean().notNull().default(false),
  target_ready_baileys: integer().notNull().default(2),
  target_ready_wwebjs: integer().notNull().default(2),
  target_ready_whatsmeow: integer().notNull().default(2),
  scan_interval_seconds: integer().notNull().default(30),
  reservation_ttl_seconds: integer().notNull().default(90),
  warming_stale_after_seconds: integer().notNull().default(180),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});
