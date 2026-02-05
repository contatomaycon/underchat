import * as schema from '@core/models';
import { userChannel } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { UserChannelCreatorRepository } from './UserChannelCreator.repository';

@injectable()
export class UserChannelsUpdaterTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly userChannelCreatorRepository: UserChannelCreatorRepository
  ) {}

  updateUserChannels = async (
    userId: string,
    accountId: string,
    channelIds: string[]
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      await tx
        .delete(userChannel)
        .where(eq(userChannel.user_id, userId))
        .execute();

      if (channelIds.length > 0) {
        const insertPromises = channelIds.map((channelId) =>
          this.userChannelCreatorRepository.createUserChannelInTransaction(
            tx,
            userId,
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
