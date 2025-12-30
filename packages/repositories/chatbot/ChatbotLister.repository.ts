import * as schema from '@core/models';
import { chatbot } from '@core/models';
import { ListChatbotResponse } from '@core/schema/chatbot/listChatbot/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, asc } from 'drizzle-orm';

@injectable()
export class ChatbotListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listChatbots = async (accountId: string): Promise<ListChatbotResponse[]> => {
    const result = await this.dbRo
      .select({
        chatbot_id: chatbot.chatbot_id,
        name: chatbot.name,
        created_at: chatbot.created_at,
      })
      .from(chatbot)
      .where(eq(chatbot.account_id, accountId))
      .orderBy(asc(chatbot.created_at))
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((chatbot) => ({
      chatbot_id: chatbot.chatbot_id,
      name: chatbot.name,
      created_at: chatbot.created_at || '',
    }));
  };
}
