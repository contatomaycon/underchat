import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { ContactGroupCreatorRepository } from './ContactGroupCreator.repository';
import { ContactGroupAssignmentCreatorRepository } from './ContactGroupAssignmentCreator.repository';
import { CreateContactGroupRequest } from '@core/schema/contactGroup/createContactGroup/request.schema';
import { v7 as uuidv7 } from 'uuid';
import {
  ContactGroupOutboundWebhookBatchService,
  type ContactGroupOutboundWebhookBatch,
} from '@core/services/contactGroupOutboundWebhookBatch.service';

@injectable()
export class ContactGroupCreatorTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject(ContactGroupCreatorRepository)
    private readonly contactGroupCreatorRepository: ContactGroupCreatorRepository,
    @inject(ContactGroupAssignmentCreatorRepository)
    private readonly contactGroupAssignmentCreatorRepository: ContactGroupAssignmentCreatorRepository,
    @inject(ContactGroupOutboundWebhookBatchService)
    private readonly outboundWebhookBatchService: ContactGroupOutboundWebhookBatchService
  ) {}

  createContactGroup = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateContactGroupRequest,
    actorUserId?: string
  ): Promise<boolean> => {
    const contactGroupId = uuidv7();
    const operationId = uuidv7();
    const contactIds = [
      ...new Set(
        (input.contacts ?? [])
          .map((contact) => contact.contact_id)
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));
    let batch: ContactGroupOutboundWebhookBatch | null = null;

    try {
      await this.dbRw.transaction(async (tx) => {
        batch = await this.outboundWebhookBatchService.prepareInTransaction({
          tx,
          accountId,
          actorUserId,
          operationId,
          operation: 'created',
          contactGroupId,
          contactGroupName: input.name,
          affectedContactIds: contactIds,
          nextMemberIds: new Set(contactIds),
        });

        const createdContactGroupId =
          await this.contactGroupCreatorRepository.createContactGroup(
            tx,
            input,
            accountId,
            contactGroupId
          );
        if (!createdContactGroupId) {
          throw new Error(t('contact_group_creation_failed'));
        }

        for (const contactId of contactIds) {
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
