import { pgTable, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account, sector, user } from '@core/models';
import { aiAgent } from './aiAgent.model';
import { EAiAgentHumanTransferTargetType } from '@core/common/enums/EAiAgentHumanTransferTargetType';

export const aiAgentHumanTransferTarget = pgTable(
  'ai_agent_human_transfer_target',
  {
    ai_agent_human_transfer_target_id: uuid()
      .primaryKey()
      .notNull()
      .defaultRandom(),
    ai_agent_id: uuid()
      .references(() => aiAgent.ai_agent_id, { onDelete: 'cascade' })
      .notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    target_type: varchar('target_type', { length: 20 })
      .notNull()
      .$type<EAiAgentHumanTransferTargetType>(),
    sector_id: uuid().references(() => sector.sector_id, {
      onDelete: 'cascade',
    }),
    user_id: uuid().references(() => user.user_id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('ai_agent_human_transfer_target_ai_agent_id_idx').on(
      table.ai_agent_id
    ),
    index('ai_agent_human_transfer_target_account_id_idx').on(table.account_id),
    index('ai_agent_human_transfer_target_ai_agent_id_account_id_idx').on(
      table.ai_agent_id,
      table.account_id
    ),
  ]
);

export const aiAgentHumanTransferTargetRelations = relations(
  aiAgentHumanTransferTarget,
  ({ one }) => ({
    aag: one(aiAgent, {
      fields: [aiAgentHumanTransferTarget.ai_agent_id],
      references: [aiAgent.ai_agent_id],
    }),
    acc: one(account, {
      fields: [aiAgentHumanTransferTarget.account_id],
      references: [account.account_id],
    }),
    sec: one(sector, {
      fields: [aiAgentHumanTransferTarget.sector_id],
      references: [sector.sector_id],
    }),
    usr: one(user, {
      fields: [aiAgentHumanTransferTarget.user_id],
      references: [user.user_id],
    }),
  })
);
