import * as schema from '@core/models';
import { contactLabelTemplate, labelTemplate } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, ExtractTablesWithRelations, isNull } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import {
  type ContactOutboundWebhookMarker,
  lockContactOutboundWebhookSnapshotInTransaction,
  markContactOutboundWebhookAppliedInTransaction,
} from './contactOutboundWebhookOutbox';

@injectable()
export class ContactLabelTemplateDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  findContactLabelTemplateId = async (
    contactId: string,
    labelTemplateId: string,
    accountId: string
  ): Promise<string | null> => {
    const result = await this.dbRw
      .select({
        id: contactLabelTemplate.contact_label_template_id,
      })
      .from(contactLabelTemplate)
      .innerJoin(
        labelTemplate,
        eq(
          labelTemplate.label_template_id,
          contactLabelTemplate.label_template_id
        )
      )
      .where(
        and(
          eq(contactLabelTemplate.contact_id, contactId),
          eq(contactLabelTemplate.label_template_id, labelTemplateId),
          eq(labelTemplate.account_id, accountId),
          isNull(labelTemplate.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return result[0]?.id ?? null;
  };

  deleteContactLabelTemplatesByContactId = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string
  ): Promise<boolean> => {
    const result = await tx
      .delete(contactLabelTemplate)
      .where(eq(contactLabelTemplate.contact_id, contactId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  deleteContactLabelTemplateByContactIdAndLabelTemplateId = async (
    contactId: string,
    labelTemplateId: string,
    accountId: string,
    webhookMarker?: ContactOutboundWebhookMarker | null
  ): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      const labels = await tx
        .select({ id: labelTemplate.label_template_id })
        .from(labelTemplate)
        .where(
          and(
            eq(labelTemplate.label_template_id, labelTemplateId),
            eq(labelTemplate.account_id, accountId),
            isNull(labelTemplate.deleted_at)
          )
        )
        .for('key share')
        .limit(1)
        .execute();
      if (!labels[0]) throw new Error('label_template_account_mismatch');

      const previousContact =
        await lockContactOutboundWebhookSnapshotInTransaction(
          tx,
          contactId,
          webhookMarker,
          accountId
        );
      const result = await tx
        .delete(contactLabelTemplate)
        .where(
          and(
            eq(contactLabelTemplate.contact_id, contactId),
            eq(contactLabelTemplate.label_template_id, labelTemplateId)
          )
        )
        .execute();
      const removed = (result.rowCount ?? 0) > 0;
      if (removed && webhookMarker) {
        await markContactOutboundWebhookAppliedInTransaction(
          tx,
          contactId,
          webhookMarker,
          previousContact
        );
      }
      return removed;
    });
  };
}
