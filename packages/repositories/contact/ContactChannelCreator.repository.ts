import * as schema from '@core/models';
import { contactChannel, worker } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ExtractTablesWithRelations, and, eq, isNull } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ContactChannelCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createContactChannelInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string,
    channelId: string,
    accountId: string
  ): Promise<string | null> => {
    const channels = await tx
      .select({ id: worker.worker_id })
      .from(worker)
      .where(
        and(
          eq(worker.worker_id, channelId),
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at)
        )
      )
      .for('key share')
      .limit(1)
      .execute();
    if (!channels[0]) throw new Error('contact_channel_not_available');

    const contactChannelId = uuidv7();
    const date = currentTime();

    const result = await tx
      .insert(contactChannel)
      .values({
        contact_channel_id: contactChannelId,
        contact_id: contactId,
        channel_id: channelId,
        account_id: accountId,
        created_at: date,
        updated_at: date,
      })
      .onConflictDoNothing({
        target: [contactChannel.contact_id, contactChannel.channel_id],
      })
      .returning({ id: contactChannel.contact_channel_id })
      .execute();

    return result[0]?.id ?? null;
  };
}
