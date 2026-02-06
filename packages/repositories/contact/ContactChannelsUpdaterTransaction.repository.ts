import * as schema from '@core/models';
import { contactChannel } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { ContactChannelCreatorRepository } from './ContactChannelCreator.repository';

@injectable()
export class ContactChannelsUpdaterTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly contactChannelCreatorRepository: ContactChannelCreatorRepository
  ) {}

  updateContactChannels = async (
    contactId: string,
    accountId: string,
    channelIds: string[]
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      await tx
        .delete(contactChannel)
        .where(eq(contactChannel.contact_id, contactId))
        .execute();

      if (channelIds.length > 0) {
        const insertPromises = channelIds.map((channelId) =>
          this.contactChannelCreatorRepository.createContactChannelInTransaction(
            tx,
            contactId,
            channelId,
            accountId
          )
        );

        await Promise.all(insertPromises);
      }

      return true;
    });
  };
}
