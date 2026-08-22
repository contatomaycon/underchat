import * as schema from '@core/models';
import { contactChannel, worker } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ContactChannelCreatorRepository } from './ContactChannelCreator.repository';
import type { Transaction } from '@core/common/types/Transaction.type';
import { lockContactOutboundWebhookSnapshotInTransaction } from './contactOutboundWebhookOutbox';

@injectable()
export class ContactChannelsUpdaterTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject(ContactChannelCreatorRepository)
    private readonly contactChannelCreatorRepository: ContactChannelCreatorRepository
  ) {}

  updateContactChannels = async (
    contactId: string,
    accountId: string,
    channelIds: string[]
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      return this.updateContactChannelsInTransaction(
        tx,
        contactId,
        accountId,
        channelIds
      );
    });
  };

  updateContactChannelsInTransaction = async (
    tx: Transaction,
    contactId: string,
    accountId: string,
    channelIds: string[]
  ): Promise<boolean> => {
    await lockContactOutboundWebhookSnapshotInTransaction(
      tx,
      contactId,
      null,
      accountId
    );

    const uniqueChannelIds = [...new Set(channelIds)];
    let activeChannelIds = uniqueChannelIds;

    if (uniqueChannelIds.length > 0) {
      // Capture the pre-update assignments before validating the workers. An
      // unavailable id is safe to omit only when it was already attached to
      // this contact (for example, a legacy link to a soft-deleted worker).
      const currentAssignments = await tx
        .select({ channel_id: contactChannel.channel_id })
        .from(contactChannel)
        .where(
          and(
            eq(contactChannel.contact_id, contactId),
            eq(contactChannel.account_id, accountId)
          )
        )
        .execute();
      const currentChannelIds = new Set(
        currentAssignments.map((assignment) => assignment.channel_id)
      );

      // KEY SHARE prevents a worker from being soft-deleted between this
      // validation and the assignment rebuild inside the same transaction.
      const activeWorkers = await tx
        .select({ channel_id: worker.worker_id })
        .from(worker)
        .where(
          and(
            eq(worker.account_id, accountId),
            inArray(worker.worker_id, uniqueChannelIds),
            isNull(worker.deleted_at)
          )
        )
        .for('key share')
        .execute();
      const activeWorkerIds = new Set(
        activeWorkers.map((activeWorker) => activeWorker.channel_id)
      );
      const unavailableChannelIds = uniqueChannelIds.filter(
        (channelId) => !activeWorkerIds.has(channelId)
      );

      if (
        unavailableChannelIds.some(
          (channelId) => !currentChannelIds.has(channelId)
        )
      ) {
        throw new Error('contact_channel_not_available');
      }

      activeChannelIds = uniqueChannelIds.filter((channelId) =>
        activeWorkerIds.has(channelId)
      );
    }

    await tx
      .delete(contactChannel)
      .where(
        and(
          eq(contactChannel.contact_id, contactId),
          eq(contactChannel.account_id, accountId)
        )
      )
      .execute();

    for (const channelId of activeChannelIds) {
      const channelAssignmentId =
        await this.contactChannelCreatorRepository.createContactChannelInTransaction(
          tx,
          contactId,
          channelId,
          accountId
        );
      if (!channelAssignmentId) {
        throw new Error('contact_channel_creation_failed');
      }
    }

    return true;
  };
}
