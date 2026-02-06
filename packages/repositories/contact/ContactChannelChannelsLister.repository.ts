import * as schema from '@core/models';
import { contactChannel, worker, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

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
      .innerJoin(worker, eq(contactChannel.channel_id, worker.worker_id))
      .innerJoin(account, eq(contactChannel.account_id, account.account_id))
      .where(
        and(
          eq(contactChannel.contact_id, contactId),
          eq(contactChannel.account_id, accountId)
        )
      )
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => item.channel_id);
  };
}
