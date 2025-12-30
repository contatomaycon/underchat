import * as schema from '@core/models';
import { chatbot } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, ne } from 'drizzle-orm';

@injectable()
export class ChatbotNameExistsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  existsChatbotByName = async (
    name: string,
    accountId: string,
    excludeChatbotId?: string
  ): Promise<boolean> => {
    const conditions = [
      eq(chatbot.name, name),
      eq(chatbot.account_id, accountId),
    ];

    if (excludeChatbotId) {
      conditions.push(ne(chatbot.chatbot_id, excludeChatbotId));
    }

    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(chatbot)
      .where(and(...conditions))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
