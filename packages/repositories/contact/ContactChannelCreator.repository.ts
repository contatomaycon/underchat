import * as schema from '@core/models';
import { contactChannel } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ExtractTablesWithRelations } from 'drizzle-orm';
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
      .execute();

    if (!result) {
      return null;
    }

    return contactChannelId;
  };
}
