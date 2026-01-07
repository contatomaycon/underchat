import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  text,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '../account';
import { contactGroupAssignment } from './contactGroupAssignment.model';
import { scheduledContact } from '../schedule';

export const contactGroup = pgTable(
  'contact_group',
  {
    contact_group_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    name: varchar({ length: 100 }).notNull(),
    description: text(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('contact_group_account_id_idx').on(table.account_id),
    index('contact_group_deleted_at_idx').on(table.deleted_at),
  ]
);

export const contactGroupRelations = relations(
  contactGroup,
  ({ one, many }) => ({
    cga: one(account, {
      fields: [contactGroup.account_id],
      references: [account.account_id],
    }),
    cgt: many(contactGroupAssignment),
    cgs: many(scheduledContact),
  })
);
