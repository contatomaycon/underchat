import { pgTable, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account, user, permissionRole } from '@core/models';
import { release } from './release.model';

export const releaseAccess = pgTable(
  'release_access',
  {
    release_access_id: uuid().primaryKey().notNull(),
    release_id: uuid()
      .references(() => release.release_id)
      .notNull(),
    account_id: uuid().references(() => account.account_id),
    user_id: uuid().references(() => user.user_id),
    permission_role_id: uuid().references(
      () => permissionRole.permission_role_id
    ),
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
    index('release_access_release_id_idx').on(table.release_id),
    index('release_access_account_id_idx').on(table.account_id),
    index('release_access_user_id_idx').on(table.user_id),
    index('release_access_permission_role_id_idx').on(table.permission_role_id),
  ]
);

export const releaseAccessRelations = relations(releaseAccess, ({ one }) => ({
  rar: one(release, {
    fields: [releaseAccess.release_id],
    references: [release.release_id],
  }),
  raa: one(account, {
    fields: [releaseAccess.account_id],
    references: [account.account_id],
  }),
  rau: one(user, {
    fields: [releaseAccess.user_id],
    references: [user.user_id],
  }),
  rpr: one(permissionRole, {
    fields: [releaseAccess.permission_role_id],
    references: [permissionRole.permission_role_id],
  }),
}));
