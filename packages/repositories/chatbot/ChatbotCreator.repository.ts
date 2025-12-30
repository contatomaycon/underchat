import * as schema from '@core/models';
import { chatbot } from '@core/models';
import { CreateChatbotRequest } from '@core/schema/chatbot/createChatbot/request.schema';
import { CreateChatbotResponse } from '@core/schema/chatbot/createChatbot/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class ChatbotCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createChatbot = async (
    input: CreateChatbotRequest,
    accountId: string
  ): Promise<CreateChatbotResponse | null> => {
    const chatbotId = uuidv7();

    const result = await this.db
      .insert(chatbot)
      .values({
        chatbot_id: chatbotId,
        account_id: accountId,
        name: input.name,
      })
      .returning();

    if (!result?.length) {
      return null;
    }

    return {
      chatbot_id: result[0].chatbot_id,
      name: result[0].name,
      account_id: result[0].account_id,
      created_at: result[0].created_at || '',
      updated_at: result[0].updated_at || '',
    };
  };
}
