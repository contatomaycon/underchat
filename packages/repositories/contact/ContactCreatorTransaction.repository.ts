import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { ContactGroupAssignmentCreatorRepository } from '../contactGroup/ContactGroupAssignmentCreator.repository';
import { ContactTxCreatorRepository } from './ContactTxCreator.repository';
import { ICreateContact } from '@core/common/interfaces/ICreateContact';

@injectable()
export class ContactCreatorTransactionRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    private readonly contactTxCreatorRepository: ContactTxCreatorRepository,
    private readonly contactGroupAssignmentCreatorRepository: ContactGroupAssignmentCreatorRepository
  ) {}

  createContactTx = async (
    t: TFunction<'translation', undefined>,
    contactGroupId: string,
    input: ICreateContact
  ): Promise<boolean> => {
    await this.db.transaction(async (tx) => {
      const contactId = await this.contactTxCreatorRepository.createContact(
        tx,
        input
      );

      if (!contactId) {
        throw new Error(t('contact_creation_failed'));
      }

      if (contactGroupId) {
        const contactGroupAssignmentId =
          await this.contactGroupAssignmentCreatorRepository.createContactGroupAssignment(
            tx,
            contactGroupId,
            contactId
          );

        if (!contactGroupAssignmentId) {
          throw new Error(t('contact_group_assignment_creation_failed'));
        }
      }
    });

    return true;
  };
}
