import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { ContactGroupCreatorRepository } from './ContactGroupCreator.repository';
import { ContactGroupAssignmentCreatorRepository } from './ContactGroupAssignmentCreator.repository';
import { CreateContactGroupRequest } from '@core/schema/contactGroup/createContactGroup/request.schema';

@injectable()
export class ContactGroupCreatorTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>,
    private readonly contactGroupCreatorRepository: ContactGroupCreatorRepository,
    private readonly contactGroupAssignmentCreatorRepository: ContactGroupAssignmentCreatorRepository
  ) {}

  createContactGroup = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateContactGroupRequest
  ): Promise<boolean> => {
    await this.db.transaction(async (tx) => {
      const contactGroupId =
        await this.contactGroupCreatorRepository.createContactGroup(
          tx,
          input,
          accountId
        );

      if (!contactGroupId) {
        throw new Error(t('contact_group_creation_failed'));
      }

      await Promise.all(
        (input.contacts ?? []).map((contact) =>
          this.contactGroupAssignmentCreatorRepository.createContactGroupAssignment(
            tx,
            contactGroupId,
            contact.contact_id
          )
        )
      );
    });

    return true;
  };
}
