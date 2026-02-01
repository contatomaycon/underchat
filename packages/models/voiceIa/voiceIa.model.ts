import { pgTable, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '@core/models';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';

export const voiceIa = pgTable(
  'voice_ia',
  {
    voice_ia_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    name: varchar({ length: 200 }).notNull(),
    voice_ia_type: varchar({ length: 50 })
      .notNull()
      .$type<EVoiceIaType>()
      .default(EVoiceIaType.eleven_labs),
    status: varchar({ length: 20 })
      .notNull()
      .$type<EVoiceIaStatus>()
      .default(EVoiceIaStatus.active),
    api_key: varchar({ length: 2000 }),
    language_code: varchar({ length: 10 }).notNull().default('pt-BR'),
    voice_id: varchar({ length: 100 }).notNull(),
    model_id: varchar({ length: 100 })
      .notNull()
      .default('eleven_multilingual_v2'),
    speed: varchar({ length: 10 }).notNull().default('1'),
    stability: varchar({ length: 10 }).notNull().default('0.5'),
    similarity_boost: varchar({ length: 10 }).notNull().default('0.75'),
    style_exaggeration: varchar({ length: 10 }).notNull().default('0'),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('voice_ia_account_id_idx').on(table.account_id),
    index('voice_ia_status_idx').on(table.status),
  ]
);

export const voiceIaRelations = relations(voiceIa, ({ one }) => ({
  acc: one(account, {
    fields: [voiceIa.account_id],
    references: [account.account_id],
  }),
}));
