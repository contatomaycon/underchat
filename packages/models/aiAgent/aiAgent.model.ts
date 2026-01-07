import { pgTable, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '@core/models';
import { aiAgentType } from './aiAgentType.model';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

export const aiAgent = pgTable(
  'ai_agent',
  {
    ai_agent_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    ai_agent_type_id: uuid()
      .references(() => aiAgentType.ai_agent_type_id)
      .notNull(),
    name: varchar({ length: 200 }).notNull(),
    base_url: varchar({ length: 500 }),
    api_key: varchar({ length: 2000 }),
    model: varchar({ length: 100 }),
    chunk_size: varchar({ length: 10 }).notNull().default('600'),
    chunk_overlap: varchar({ length: 10 }).notNull().default('100'),
    status: varchar({ length: 20 })
      .notNull()
      .$type<EAiAgentStatus>()
      .default(EAiAgentStatus.active),
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
    index('ai_agent_account_id_idx').on(table.account_id),
    index('ai_agent_ai_agent_type_id_idx').on(table.ai_agent_type_id),
    index('ai_agent_status_idx').on(table.status),
    index('ai_agent_account_id_status_idx').on(table.account_id, table.status),
  ]
);

export const aiAgentRelations = relations(aiAgent, ({ one }) => ({
  acc: one(account, {
    fields: [aiAgent.account_id],
    references: [account.account_id],
  }),
  aat: one(aiAgentType, {
    fields: [aiAgent.ai_agent_type_id],
    references: [aiAgentType.ai_agent_type_id],
  }),
}));
