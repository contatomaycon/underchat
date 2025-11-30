import * as schema from '@core/models';
import { chatbot } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class ChatbotNameExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsChatbotByName = async (
    name: string,
    accountId: string
  ): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(chatbot)
      .where(and(eq(chatbot.name, name), eq(chatbot.account_id, accountId)))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
