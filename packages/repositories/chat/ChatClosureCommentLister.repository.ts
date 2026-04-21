import * as schema from '@core/models';
import { chatClosureComment } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, eq } from 'drizzle-orm';

export type ChatClosureCommentRow = {
  comment: string;
  closed_at: string;
};

@injectable()
export class ChatClosureCommentListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listByChatId = async (
    accountId: string,
    chatId: string
  ): Promise<ChatClosureCommentRow[]> => {
    const rows = await this.dbRo
      .select({
        comment: chatClosureComment.comment,
        closed_at: chatClosureComment.closed_at,
      })
      .from(chatClosureComment)
      .where(
        and(
          eq(chatClosureComment.account_id, accountId),
          eq(chatClosureComment.chat_id, chatId)
        )
      )
      .orderBy(asc(chatClosureComment.closed_at));

    return rows.map((row) => ({
      comment: row.comment,
      closed_at: row.closed_at,
    }));
  };
}
