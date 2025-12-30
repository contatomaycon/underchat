import * as schema from '@core/models';
import { chatbot, workerConfig } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class ChatbotDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  clearChatbotFromWorkerConfigs = async (chatbotId: string): Promise<void> => {
    await this.db
      .update(workerConfig)
      .set({
        chatbot_id: null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(workerConfig.chatbot_id, chatbotId))
      .execute();
  };

  deleteChatbotById = async (chatbotId: string): Promise<boolean> => {
    const result = await this.db
      .delete(chatbot)
      .where(eq(chatbot.chatbot_id, chatbotId))
      .execute();

    return result.rowCount === 1;
  };
}
