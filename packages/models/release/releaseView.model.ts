import { pgTable, uuid, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';
import { release } from './release.model';

export const releaseView = pgTable(
  'release_view',
  {
    release_view_id: uuid().primaryKey().notNull(),
    release_id: uuid()
      .references(() => release.release_id)
      .notNull(),
    user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
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
    index('release_view_release_id_idx').on(table.release_id),
    index('release_view_user_id_idx').on(table.user_id),
    index('release_view_release_id_user_id_idx').on(
      table.release_id,
      table.user_id
    ),
  ]
);

export const releaseViewRelations = relations(releaseView, ({ one }) => ({
  rvr: one(release, {
    fields: [releaseView.release_id],
    references: [release.release_id],
  }),
  rvu: one(user, {
    fields: [releaseView.user_id],
    references: [user.user_id],
  }),
}));
