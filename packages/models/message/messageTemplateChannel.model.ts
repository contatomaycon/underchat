import {
  index,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { messageTemplate, worker } from '@core/models';
import { relations } from 'drizzle-orm';

export const messageTemplateChannel = pgTable(
  'message_template_channel',
  {
    message_template_id: uuid()
      .references(() => messageTemplate.message_template_id)
      .notNull(),
    channel_id: uuid()
      .references(() => worker.worker_id)
      .notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.message_template_id, table.channel_id],
      name: 'message_template_channel_message_template_id_channel_id_pk',
    }),
    index('message_template_channel_message_template_id_idx').on(
      table.message_template_id
    ),
    index('message_template_channel_channel_id_idx').on(table.channel_id),
    index('message_template_channel_message_template_id_channel_id_idx').on(
      table.message_template_id,
      table.channel_id
    ),
  ]
);

export const messageTemplateChannelRelations = relations(
  messageTemplateChannel,
  ({ one }) => ({
    mtcm: one(messageTemplate, {
      fields: [messageTemplateChannel.message_template_id],
      references: [messageTemplate.message_template_id],
    }),
    mtcw: one(worker, {
      fields: [messageTemplateChannel.channel_id],
      references: [worker.worker_id],
    }),
  })
);
