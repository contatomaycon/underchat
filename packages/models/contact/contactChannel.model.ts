import {
  pgTable,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { contact } from './contact.model';
import { worker } from '../worker/worker.model';
import { account } from '../account/account.model';

export const contactChannel = pgTable(
  'contact_channel',
  {
    contact_channel_id: uuid().primaryKey().notNull(),
    contact_id: uuid()
      .references(() => contact.contact_id)
      .notNull(),
    channel_id: uuid().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
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
    index('contact_channel_contact_id_idx').on(table.contact_id),
    index('contact_channel_channel_id_idx').on(table.channel_id),
    index('contact_channel_account_id_idx').on(table.account_id),
    index('contact_channel_contact_id_channel_id_idx').on(
      table.contact_id,
      table.channel_id
    ),
    uniqueIndex('contact_channel_contact_channel_uidx').on(
      table.contact_id,
      table.channel_id
    ),
    index('contact_channel_contact_id_account_id_idx').on(
      table.contact_id,
      table.account_id
    ),
    index('contact_channel_account_id_channel_id_idx').on(
      table.account_id,
      table.channel_id
    ),
    foreignKey({
      name: 'contact_channel_account_channel_fkey',
      columns: [table.account_id, table.channel_id],
      foreignColumns: [worker.account_id, worker.worker_id],
    }).onDelete('restrict'),
  ]
);

export const contactChannelRelations = relations(contactChannel, ({ one }) => ({
  ccc: one(contact, {
    fields: [contactChannel.contact_id],
    references: [contact.contact_id],
  }),
  ccw: one(worker, {
    fields: [contactChannel.account_id, contactChannel.channel_id],
    references: [worker.account_id, worker.worker_id],
  }),
  cca: one(account, {
    fields: [contactChannel.account_id],
    references: [account.account_id],
  }),
}));
