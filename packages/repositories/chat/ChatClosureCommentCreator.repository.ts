import * as schema from '@core/models';
import { chatClosureComment } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ChatClosureCommentCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  create = async (data: {
    accountId: string;
    chatId: string;
    userId: string;
    comment: string;
    closedAt: string;
  }): Promise<void> => {
    await this.dbRw.insert(chatClosureComment).values({
      account_id: data.accountId,
      chat_id: data.chatId,
      user_id: data.userId,
      comment: data.comment,
      closed_at: data.closedAt,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  };
}
