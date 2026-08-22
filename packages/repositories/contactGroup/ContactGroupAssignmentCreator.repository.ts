import * as schema from '@core/models';
import { contactGroup, contactGroupAssignment } from '@core/models';
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
} from '@core/repositories/contact/contactOutboundWebhookOutbox';

@injectable()
export class ContactGroupAssignmentCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createContactGroupAssignment = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactGroupId: string,
    contactId: string,
    accountId: string,
    requestedAssignmentId?: string,
    webhookMarker?: ContactOutboundWebhookMarker | null
  ): Promise<string | null> => {
    const groups = await tx
      .select({ id: contactGroup.contact_group_id })
      .from(contactGroup)
      .where(
        and(
          eq(contactGroup.contact_group_id, contactGroupId),
          eq(contactGroup.account_id, accountId),
          isNull(contactGroup.deleted_at)
        )
      )
      .for('key share')
      .limit(1)
      .execute();
    if (!groups[0]) {
      throw new Error('contact_group_account_mismatch');
    }

    const previousContact =
      await lockContactOutboundWebhookSnapshotInTransaction(
        tx,
        contactId,
        webhookMarker,
        accountId
      );
    const contactGroupAssignmentId = requestedAssignmentId ?? uuidv7();

    const result = await tx
      .insert(contactGroupAssignment)
      .values({
        contact_group_assignment_id: contactGroupAssignmentId,
        contact_group_id: contactGroupId,
        contact_id: contactId,
      })
      .onConflictDoNothing({
        target: [
          contactGroupAssignment.contact_id,
          contactGroupAssignment.contact_group_id,
        ],
      })
      .returning({
        id: contactGroupAssignment.contact_group_assignment_id,
      })
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

  createContactGroupAssignmentDirectly = async (
    contactGroupId: string,
    contactId: string,
    accountId: string,
    requestedAssignmentId?: string,
    webhookMarker?: ContactOutboundWebhookMarker | null
  ): Promise<string | null> => {
    return this.dbRw.transaction((tx) =>
      this.createContactGroupAssignment(
        tx,
        contactGroupId,
        contactId,
        accountId,
        requestedAssignmentId,
        webhookMarker
      )
    );
  };
}
