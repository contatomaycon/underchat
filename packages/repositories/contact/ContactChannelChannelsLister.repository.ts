import * as schema from '@core/models';
import { contactChannel, worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class ContactChannelChannelsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listChannelIdsByContactAndAccount = async (
    contactId: string,
    accountId: string
  ): Promise<string[]> => {
    const result = await this.dbRo
      .select({
        channel_id: contactChannel.channel_id,
      })
      .from(contactChannel)
      .innerJoin(
        worker,
        and(
          eq(contactChannel.channel_id, worker.worker_id),
          eq(contactChannel.account_id, worker.account_id)
        )
      )
      .where(
        and(
          eq(contactChannel.contact_id, contactId),
          eq(contactChannel.account_id, accountId),
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => item.channel_id);
  };
}
