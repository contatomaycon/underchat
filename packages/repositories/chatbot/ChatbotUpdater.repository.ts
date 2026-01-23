import * as schema from '@core/models';
import { chatbot } from '@core/models';
import { UpdateChatbotRequest } from '@core/schema/chatbot/updateChatbot/request.schema';
import { UpdateChatbotResponse } from '@core/schema/chatbot/updateChatbot/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { EChatbotType } from '@core/common/enums/EChatbotType';

@injectable()
export class ChatbotUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateChatbot = async (
    chatbotId: string,
    input: UpdateChatbotRequest
  ): Promise<UpdateChatbotResponse | null> => {
    const updateData: {
      name: string;
      updated_at: string;
      type?: EChatbotType | null;
    } = {
      name: input.name,
      updated_at: new Date().toISOString(),
    };

    if (input.type !== undefined) {
      updateData.type = input.type as EChatbotType | null;
    }

    const result = await this.dbRw
      .update(chatbot)
      .set(updateData)
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
