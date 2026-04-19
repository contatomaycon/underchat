import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account, releaseAccess, user } from '@core/models';
import { releaseView } from './releaseView.model';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { EReleaseStatus } from '@core/common/enums/EReleaseStatus';

export const release = pgTable(
  'release',
  {
    release_id: uuid().primaryKey().notNull(),
    account_id: uuid().references(() => account.account_id),
    created_by_user_id: uuid().references(() => user.user_id),
    type: varchar({ length: 20 })
      .notNull()
      .$type<EReleaseType>()
      .default(EReleaseType.informative),
    status: varchar({ length: 20 })
      .notNull()
      .$type<EReleaseStatus>()
      .default(EReleaseStatus.active),
    title: varchar({ length: 200 }).notNull(),
    message: text().notNull(),
    reminder_at: timestamp({
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
    index('release_account_id_idx').on(table.account_id),
    index('release_created_by_user_id_idx').on(table.created_by_user_id),
    index('release_type_idx').on(table.type),
    index('release_status_idx').on(table.status),
    index('release_account_id_status_idx').on(table.account_id, table.status),
  ]
);

export const releaseRelations = relations(release, ({ one, many }) => ({
  rac: one(account, {
    fields: [release.account_id],
    references: [account.account_id],
  }),
  rcb: one(user, {
    fields: [release.created_by_user_id],
    references: [user.user_id],
  }),
  raa: many(releaseAccess),
  rav: many(releaseView),
}));
