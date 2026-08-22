import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { ContactGroupAssignmentDeleterRepository } from './ContactGroupAssignmentDeleter.repository';
import { ContactGroupDeleterRepository } from './ContactGroupDeleter.repository';
import { contact, contactGroup, contactGroupAssignment } from '@core/models';
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  ContactGroupOutboundWebhookBatchService,
  type ContactGroupOutboundWebhookBatch,
} from '@core/services/contactGroupOutboundWebhookBatch.service';

@injectable()
export class ContactGroupDeleterTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject(ContactGroupAssignmentDeleterRepository)
    private readonly contactGroupAssignmentDeleterRepository: ContactGroupAssignmentDeleterRepository,
    @inject(ContactGroupDeleterRepository)
    private readonly contactGroupDeleterRepository: ContactGroupDeleterRepository,
    @inject(ContactGroupOutboundWebhookBatchService)
    private readonly outboundWebhookBatchService: ContactGroupOutboundWebhookBatchService
  ) {}

  deleteContactGroup = async (
    t: TFunction<'translation', undefined>,
    contactGroupId: string,
    accountId: string,
    actorUserId?: string
  ): Promise<boolean> => {
    const operationId = uuidv7();
    let batch: ContactGroupOutboundWebhookBatch | null = null;

    try {
      await this.dbRw.transaction(async (tx) => {
        const groups = await tx
          .select({
            id: contactGroup.contact_group_id,
            name: contactGroup.name,
          })
          .from(contactGroup)
          .where(
            and(
              eq(contactGroup.contact_group_id, contactGroupId),
              eq(contactGroup.account_id, accountId),
              isNull(contactGroup.deleted_at)
            )
          )
          .for('update')
          .limit(1)
          .execute();
        const currentGroup = groups[0];
        if (!currentGroup) throw new Error(t('contact_group_not_found'));

        const assignmentRows = await tx
          .select({ contactId: contactGroupAssignment.contact_id })
          .from(contactGroupAssignment)
          .where(eq(contactGroupAssignment.contact_group_id, contactGroupId))
          .execute();
        const validAssignmentRows = await tx
          .select({ contactId: contactGroupAssignment.contact_id })
          .from(contactGroupAssignment)
          .innerJoin(
            contact,
            and(
              eq(contact.contact_id, contactGroupAssignment.contact_id),
              eq(contact.account_id, accountId),
              isNull(contact.deleted_at)
            )
          )
          .where(eq(contactGroupAssignment.contact_group_id, contactGroupId))
          .execute();
        const affectedContactIds = [
          ...new Set(validAssignmentRows.map((row) => row.contactId)),
        ];

        batch = await this.outboundWebhookBatchService.prepareInTransaction({
          tx,
          accountId,
          actorUserId,
          operationId,
          operation: 'deleted',
          contactGroupId,
          contactGroupName: currentGroup.name,
          affectedContactIds,
          nextMemberIds: new Set(),
        });

        if (assignmentRows.length > 0) {
          const assignmentsDeleted =
            await this.contactGroupAssignmentDeleterRepository.deleteContactGroupAssignmentById(
              tx,
              contactGroupId
            );
          if (!assignmentsDeleted) {
            throw new Error(t('contact_group_assignment_deleter_error'));
          }
        }

        const contactGroupDeleted =
          await this.contactGroupDeleterRepository.deleteContactGroupById(
            tx,
            contactGroupId,
            accountId
          );
        if (!contactGroupDeleted) {
          throw new Error(t('contact_group_deleter_error'));
        }

        await this.outboundWebhookBatchService.markAppliedInTransaction(
          tx,
          batch
        );
      });
    } catch (error) {
      await this.outboundWebhookBatchService.cancelBestEffort(batch);
      throw error;
    }

    await this.outboundWebhookBatchService.completePersistedBestEffort(batch);

    return true;
  };
}
