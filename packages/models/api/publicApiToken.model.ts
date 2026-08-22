import {
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { account, user } from '@core/models';

export const publicApiToken = pgTable(
  'public_api_token',
  {
    public_api_token_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    actor_user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
    token_hash: varchar({ length: 64 }).notNull(),
    token_encrypted: varchar({ length: 512 }).notNull(),
    token_preview: varchar({ length: 32 }).notNull(),
    created_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp({ mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
    rotated_at: timestamp({ mode: 'string', withTimezone: true }),
    last_used_at: timestamp({ mode: 'string', withTimezone: true }),
    revoked_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    uniqueIndex('public_api_token_token_hash_uidx').on(table.token_hash),
    uniqueIndex('public_api_token_active_account_uidx')
      .on(table.account_id)
      .where(sql`${table.revoked_at} IS NULL`),
    index('public_api_token_actor_user_id_idx').on(table.actor_user_id),
    index('public_api_token_account_id_created_at_idx').on(
      table.account_id,
      table.created_at.desc()
    ),
  ]
);

export const publicApiTokenRelations = relations(publicApiToken, ({ one }) => ({
  account: one(account, {
    fields: [publicApiToken.account_id],
    references: [account.account_id],
  }),
  actor: one(user, {
    fields: [publicApiToken.actor_user_id],
    references: [user.user_id],
  }),
}));
