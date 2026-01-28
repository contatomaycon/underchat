import * as schema from '@core/models';
import { chatbot } from '@core/models';
import { CloneChatbotResponse } from '@core/schema/chatbot/cloneChatbot/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import { EChatbotType } from '@core/common/enums/EChatbotType';

@injectable()
export class ChatbotClonerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  findChatbotById = async (
    chatbotId: string,
    accountId: string
  ): Promise<{
    chatbot_id: string;
    name: string;
    type: string | null;
    account_id: string;
  } | null> => {
    const result = await this.dbRo
      .select({
        chatbot_id: chatbot.chatbot_id,
        name: chatbot.name,
        type: chatbot.type,
        account_id: chatbot.account_id,
      })
      .from(chatbot)
      .where(
        and(
          eq(chatbot.chatbot_id, chatbotId),
          eq(chatbot.account_id, accountId)
        )
      )
      .limit(1)
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0];
  };

  cloneChatbot = async (
    originalChatbotId: string,
    newName: string,
    accountId: string
  ): Promise<CloneChatbotResponse | null> => {
    const originalChatbot = await this.findChatbotById(
      originalChatbotId,
      accountId
    );

    if (!originalChatbot) {
      return null;
    }

    const newChatbotId = uuidv7();

    const typeValue =
      originalChatbot.type &&
      Object.values(EChatbotType).includes(originalChatbot.type as EChatbotType)
        ? (originalChatbot.type as EChatbotType)
        : EChatbotType.input;

    const result = await this.dbRw
      .insert(chatbot)
      .values({
        chatbot_id: newChatbotId,
        account_id: accountId,
        name: newName,
        type: typeValue,
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
