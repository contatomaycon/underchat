import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  integer,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { aiAgent } from './aiAgent.model';

export const aiAgentUsage = pgTable(
  'ai_agent_usage',
  {
    id: uuid().primaryKey().notNull().defaultRandom(),
    ai_agent_id: uuid()
      .references(() => aiAgent.ai_agent_id)
      .notNull(),
    account_id: uuid(),
    chat_id: varchar({ length: 500 }),
    prompt_tokens: integer(),
    completion_tokens: integer(),
    total_tokens: integer(),
    model: varchar({ length: 100 }),
    latency_ms: integer(),
    success: boolean(),
    request_type: varchar({ length: 50 }),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('ai_agent_usage_ai_agent_id_idx').on(table.ai_agent_id),
    index('ai_agent_usage_account_id_idx').on(table.account_id),
    index('ai_agent_usage_created_at_idx').on(table.created_at),
    index('ai_agent_usage_ai_agent_id_created_at_idx').on(
      table.ai_agent_id,
      table.created_at
    ),
  ]
);

export const aiAgentUsageRelations = relations(aiAgentUsage, ({ one }) => ({
  aai: one(aiAgent, {
    fields: [aiAgentUsage.ai_agent_id],
    references: [aiAgent.ai_agent_id],
  }),
}));
