import * as schema from '@core/models';
import { contact } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, ExtractTablesWithRelations, isNull } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { currentTime } from '@core/common/functions/currentTime';
import { ContactLabelTemplateDeleterRepository } from './ContactLabelTemplateDeleter.repository';
import {
  type ContactOutboundWebhookMarker,
  lockContactOutboundWebhookSnapshotInTransaction,
  markContactOutboundWebhookAppliedInTransaction,
} from './contactOutboundWebhookOutbox';

@injectable()
export class ContactDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject(ContactLabelTemplateDeleterRepository)
    private readonly contactLabelTemplateDeleterRepository: ContactLabelTemplateDeleterRepository
  ) {}

  private deleteContactInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string,
    accountId?: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await tx
      .update(contact)
      .set({
        deleted_at: date,
      })
      .where(
        and(
          eq(contact.contact_id, contactId),
          isNull(contact.deleted_at),
          accountId ? eq(contact.account_id, accountId) : undefined
        )
      )
      .execute();

    return result.rowCount === 1;
  };

  deleteContactById = async (
    contactId: string,
    accountId?: string,
    webhookMarker?: ContactOutboundWebhookMarker | null
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const previousContact =
        await lockContactOutboundWebhookSnapshotInTransaction(
          tx,
          contactId,
          webhookMarker
        );
      const deleted = await this.deleteContactInTransaction(
        tx,
        contactId,
        accountId
      );
      if (!deleted) return false;

      await this.contactLabelTemplateDeleterRepository.deleteContactLabelTemplatesByContactId(
        tx,
        contactId
      );
      await markContactOutboundWebhookAppliedInTransaction(
        tx,
        contactId,
        webhookMarker,
        previousContact
      );
      return deleted;
    });
  };
}
