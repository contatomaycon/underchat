import {
  pgTable,
  timestamp,
  uuid,
  varchar,
  text,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { aiAgent } from './aiAgent.model';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';

export const aiAgentPrompt = pgTable(
  'ai_agent_prompt',
  {
    ai_agent_prompt_id: uuid().primaryKey().notNull(),
    ai_agent_id: uuid()
      .references(() => aiAgent.ai_agent_id)
      .notNull(),
    ai_agent_prompt_type: varchar({ length: 20 })
      .notNull()
      .$type<EAiAgentPromptType>(),
    name: varchar({ length: 200 }).notNull(),
    value: text().notNull(),
    openai_file_id: varchar('openai_file_id', { length: 200 }),
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
    index('ai_agent_prompt_ai_agent_id_idx').on(table.ai_agent_id),
    index('ai_agent_prompt_status_idx').on(table.status),
    index('ai_agent_prompt_ai_agent_id_status_idx').on(
      table.ai_agent_id,
      table.status
    ),
  ]
);

export const aiAgentPromptRelations = relations(aiAgentPrompt, ({ one }) => ({
  aag: one(aiAgent, {
    fields: [aiAgentPrompt.ai_agent_id],
    references: [aiAgent.ai_agent_id],
  }),
}));
