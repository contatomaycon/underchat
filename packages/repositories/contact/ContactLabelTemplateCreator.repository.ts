import * as schema from '@core/models';
import { contactLabelTemplate, labelTemplate } from '@core/models';
import { ExtractTablesWithRelations, and, eq, isNull } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import {
  type ContactOutboundWebhookMarker,
  lockContactOutboundWebhookSnapshotInTransaction,
  markContactOutboundWebhookAppliedInTransaction,
} from './contactOutboundWebhookOutbox';

@injectable()
export class ContactLabelTemplateCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createContactLabelTemplate = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string,
    labelTemplateId: string,
    accountId: string,
    requestedAssignmentId?: string,
    webhookMarker?: ContactOutboundWebhookMarker | null
  ): Promise<string | null> => {
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
    const contactLabelTemplateId = requestedAssignmentId ?? uuidv7();

    const result = await tx
      .insert(contactLabelTemplate)
      .values({
        contact_label_template_id: contactLabelTemplateId,
        contact_id: contactId,
        label_template_id: labelTemplateId,
      })
      .onConflictDoNothing({
        target: [
          contactLabelTemplate.contact_id,
          contactLabelTemplate.label_template_id,
        ],
      })
      .returning({ id: contactLabelTemplate.contact_label_template_id })
      .execute();

    const createdAssignmentId = result[0]?.id ?? null;
    if (createdAssignmentId && webhookMarker) {
      await markContactOutboundWebhookAppliedInTransaction(
        tx,
        contactId,
        webhookMarker,
        previousContact
      );
    }
    return createdAssignmentId;
  };

  createContactLabelTemplateWithoutTransaction = async (
    contactId: string,
    labelTemplateId: string,
    accountId: string,
    requestedAssignmentId?: string,
    webhookMarker?: ContactOutboundWebhookMarker | null
  ): Promise<string | null> => {
    return this.dbRw.transaction((tx) =>
      this.createContactLabelTemplate(
        tx,
        contactId,
        labelTemplateId,
        accountId,
        requestedAssignmentId,
        webhookMarker
      )
    );
  };
}
