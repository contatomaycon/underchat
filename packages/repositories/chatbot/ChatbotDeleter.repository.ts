import * as schema from '@core/models';
import { chatbot, schedule, workerConfig } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class ChatbotDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  clearChatbotFromSchedules = async (chatbotId: string): Promise<void> => {
    await this.dbRw
      .update(schedule)
      .set({
        chatbot_id: null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(schedule.chatbot_id, chatbotId))
      .execute();
  };

  clearChatbotFromWorkerConfigs = async (chatbotId: string): Promise<void> => {
    await this.dbRw
      .update(workerConfig)
      .set({
        chatbot_id: null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(workerConfig.chatbot_id, chatbotId))
      .execute();
  };

  deleteChatbotById = async (chatbotId: string): Promise<boolean> => {
    const result = await this.dbRw
      .delete(chatbot)
      .where(eq(chatbot.chatbot_id, chatbotId))
      .execute();

    return result.rowCount === 1;
  };
}
