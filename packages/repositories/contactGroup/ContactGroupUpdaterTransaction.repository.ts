import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { ContactGroupAssignmentCreatorRepository } from './ContactGroupAssignmentCreator.repository';
import { ContactGroupAssignmentDeleterRepository } from './ContactGroupAssignmentDeleter.repository';
import { UpdateContactGroupRequest } from '@core/schema/contactGroup/editContactGroup/request.schema';
import { ContactGroupUpdaterRepository } from './ContactGroupUpdater.repository';
import { contact, contactGroup, contactGroupAssignment } from '@core/models';
import { and, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  ContactGroupOutboundWebhookBatchService,
  type ContactGroupOutboundWebhookBatch,
} from '@core/services/contactGroupOutboundWebhookBatch.service';

@injectable()
export class ContactGroupUpdaterTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject(ContactGroupAssignmentDeleterRepository)
    private readonly contactGroupAssignmentDeleterRepository: ContactGroupAssignmentDeleterRepository,
    @inject(ContactGroupAssignmentCreatorRepository)
    private readonly contactGroupAssignmentCreatorRepository: ContactGroupAssignmentCreatorRepository,
    @inject(ContactGroupUpdaterRepository)
    private readonly contactGroupUpdaterRepository: ContactGroupUpdaterRepository,
    @inject(ContactGroupOutboundWebhookBatchService)
    private readonly outboundWebhookBatchService: ContactGroupOutboundWebhookBatchService
  ) {}

  updateContactGroup = async (
    t: TFunction<'translation', undefined>,
    contactGroupId: string,
    input: UpdateContactGroupRequest,
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

        const oldAssignments = await tx
          .select({ contactId: contactGroupAssignment.contact_id })
          .from(contactGroupAssignment)
          .where(eq(contactGroupAssignment.contact_group_id, contactGroupId))
          .execute();
        const validOldAssignments = await tx
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

        const oldMemberIds = new Set(
          oldAssignments.map((assignment) => assignment.contactId)
        );
        const validOldMemberIds = new Set(
          validOldAssignments.map((assignment) => assignment.contactId)
        );
        const hasMembershipUpdate = Object.prototype.hasOwnProperty.call(
          input,
          'contacts'
        );
        const requestedMemberIds = [
          ...new Set(
            (input.contacts ?? [])
              .map((member) => member.contact_id)
              .filter(Boolean)
          ),
        ].sort((a, b) => a.localeCompare(b));
        const nextMemberIds = hasMembershipUpdate
          ? new Set(requestedMemberIds)
          : new Set(oldMemberIds);
        const membershipChanged =
          oldMemberIds.size !== nextMemberIds.size ||
          [...oldMemberIds].some((contactId) => !nextMemberIds.has(contactId));
        const nextGroupName =
          typeof input.name === 'string' && input.name.length > 0
            ? input.name
            : currentGroup.name;
        const publicNameChanged = nextGroupName !== currentGroup.name;
        const affectedContactIds =
          membershipChanged || publicNameChanged
            ? [...new Set([...validOldMemberIds, ...nextMemberIds])]
            : [];

        batch = await this.outboundWebhookBatchService.prepareInTransaction({
          tx,
          accountId,
          actorUserId,
          operationId,
          operation: 'updated',
          contactGroupId,
          contactGroupName: nextGroupName,
          affectedContactIds,
          nextMemberIds,
        });

        const updated =
          await this.contactGroupUpdaterRepository.updateContactGroupById(
            tx,
            contactGroupId,
            input,
            accountId
          );
        if (!updated) {
          throw new Error(t('contact_group_update_error'));
        }

        if (membershipChanged) {
          const removedIds = [...oldMemberIds]
            .filter((contactId) => !nextMemberIds.has(contactId))
            .sort((a, b) => a.localeCompare(b));
          const addedIds = [...nextMemberIds]
            .filter((contactId) => !oldMemberIds.has(contactId))
            .sort((a, b) => a.localeCompare(b));

          for (const contactId of removedIds) {
            const removed =
              await this.contactGroupAssignmentDeleterRepository.deleteContactGroupAssignmentByGroupAndContact(
                tx,
                contactGroupId,
                contactId
              );
            if (!removed) {
              throw new Error(t('contact_group_assignment_deleter_error'));
            }
          }

          for (const contactId of addedIds) {
            const assignmentId =
              await this.contactGroupAssignmentCreatorRepository.createContactGroupAssignment(
                tx,
                contactGroupId,
                contactId,
                accountId
              );
            if (!assignmentId) {
              throw new Error(t('contact_group_assignment_creation_failed'));
            }
          }
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
