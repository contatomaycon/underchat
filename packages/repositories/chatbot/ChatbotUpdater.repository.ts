import * as schema from '@core/models';
import { chatbot } from '@core/models';
import { UpdateChatbotRequest } from '@core/schema/chatbot/updateChatbot/request.schema';
import { UpdateChatbotResponse } from '@core/schema/chatbot/updateChatbot/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class ChatbotUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateChatbot = async (
    chatbotId: string,
    input: UpdateChatbotRequest
  ): Promise<UpdateChatbotResponse | null> => {
    const result = await this.db
      .update(chatbot)
      .set({
        name: input.name,
        updated_at: new Date().toISOString(),
      })
      .where(eq(chatbot.chatbot_id, chatbotId))
      .returning();

    if (!result?.length) {
      return null;
    }

    return {
      chatbot_id: result[0].chatbot_id,
      name: result[0].name,
      updated_at: result[0].updated_at || '',
    };
  };
}
