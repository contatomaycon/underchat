import * as schema from '@core/models';
import { chatbot } from '@core/models';
import { EChatbotType } from '@core/common/enums/EChatbotType';
import { ListScheduleChatbotsResponse } from '@core/schema/schedule/listScheduleChatbots/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, asc } from 'drizzle-orm';

@injectable()
export class ScheduleChatbotsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listScheduleChatbots = async (
    accountId: string
  ): Promise<ListScheduleChatbotsResponse[]> => {
    const result = await this.dbRo
      .select({
        chatbot_id: chatbot.chatbot_id,
        name: chatbot.name,
        type: chatbot.type,
      })
      .from(chatbot)
      .where(
        and(
          eq(chatbot.account_id, accountId),
          eq(chatbot.type, EChatbotType.schedule)
        )
      )
      .orderBy(asc(chatbot.name))
      .execute();

    if (!result.length) {
      return [];
    }

    return result.map((row) => ({
      chatbot_id: row.chatbot_id,
      name: row.name,
      type: row.type ?? null,
    }));
  };

  existsByChatbotIdAndAccount = async (
    chatbotId: string,
    accountId: string
  ): Promise<boolean> => {
    const result = await this.dbRo
      .select({ chatbot_id: chatbot.chatbot_id })
      .from(chatbot)
      .where(
        and(
          eq(chatbot.chatbot_id, chatbotId),
          eq(chatbot.account_id, accountId)
        )
      )
      .execute();

    return (result?.length ?? 0) > 0;
  };
}
