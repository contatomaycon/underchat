import { pgTable, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { aiAgent } from './aiAgent.model';

export const aiAgentType = pgTable(
  'ai_agent_type',
  {
    ai_agent_type_id: uuid().primaryKey().notNull(),
    name: varchar({ length: 100 }).notNull(),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('ai_agent_type_name_idx').on(table.name)]
);

export const aiAgentTypeRelations = relations(aiAgentType, ({ many }) => ({
  aag: many(aiAgent),
}));
