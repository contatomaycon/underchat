import * as schema from '@core/models';
import { messageStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq } from 'drizzle-orm';

@injectable()
export class MessageStatusViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsMessageStatusById = async (
    messageStatusId: string
  ): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(messageStatus)
      .where(and(eq(messageStatus.message_status_id, messageStatusId)))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
