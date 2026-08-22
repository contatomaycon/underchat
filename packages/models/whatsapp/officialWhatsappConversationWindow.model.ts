import {
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account, contact, worker } from '@core/models';

export const officialWhatsappConversationWindow = pgTable(
  'official_whatsapp_conversation_window',
  {
    official_whatsapp_conversation_window_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    worker_id: uuid()
      .references(() => worker.worker_id)
      .notNull(),
    contact_id: uuid().references(() => contact.contact_id),
    phone: varchar({ length: 32 }).notNull(),
    remote_jid: varchar({ length: 255 }),
    last_inbound_message_id: varchar({ length: 255 }),
    last_inbound_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    service_window_expires_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    awaiting_contact_reply_since: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    awaiting_template_message_id: varchar({ length: 255 }),
    last_template_sent_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    last_outbound_message_id: varchar({ length: 255 }),
    last_outbound_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    last_meta_error_code: integer(),
    closed_reason: varchar({ length: 80 }),
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
    uniqueIndex(
      'official_whatsapp_conversation_window_account_worker_phone_uidx'
    ).on(table.account_id, table.worker_id, table.phone),
    index('official_whatsapp_conversation_window_worker_phone_idx').on(
      table.worker_id,
      table.phone
    ),
    index('official_whatsapp_conversation_window_contact_idx').on(
      table.contact_id
    ),
    index('official_whatsapp_conversation_window_expires_idx').on(
      table.service_window_expires_at
    ),
    index('official_whatsapp_conversation_window_awaiting_idx').on(
      table.awaiting_contact_reply_since
    ),
  ]
);

export const officialWhatsappConversationWindowRelations = relations(
  officialWhatsappConversationWindow,
  ({ one }) => ({
    account: one(account, {
      fields: [officialWhatsappConversationWindow.account_id],
      references: [account.account_id],
    }),
    worker: one(worker, {
      fields: [officialWhatsappConversationWindow.worker_id],
      references: [worker.worker_id],
    }),
    contact: one(contact, {
      fields: [officialWhatsappConversationWindow.contact_id],
      references: [contact.contact_id],
    }),
  })
);
