import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { ContactGroupAssignmentCreatorRepository } from './ContactGroupAssignmentCreator.repository';
import { ContactGroupAssignmentDeleterRepository } from './ContactGroupAssignmentDeleter.repository';
import { ContactGroupAssignmentViewerExistsRepository } from './ContactGroupAssignmentViewerExists.repository';
import { UpdateContactGroupRequest } from '@core/schema/contactGroup/editContactGroup/request.schema';
import { ContactGroupUpdaterRepository } from './ContactGroupUpdater.repository';

@injectable()
export class ContactGroupUpdaterTransactionRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    private readonly contactGroupAssignmentDeleterRepository: ContactGroupAssignmentDeleterRepository,
    private readonly contactGroupAssignmentCreatorRepository: ContactGroupAssignmentCreatorRepository,
    private readonly contactGroupAssignmentViewerExistsRepository: ContactGroupAssignmentViewerExistsRepository,
    private readonly contactGroupUpdaterRepository: ContactGroupUpdaterRepository
  ) {}

  updateContactGroup = async (
    t: TFunction<'translation', undefined>,
    contactGroupId: string,
    input: UpdateContactGroupRequest
  ): Promise<boolean> => {
    await this.db.transaction(async (tx) => {
      const existsContactGroupAssignment =
        await this.contactGroupAssignmentViewerExistsRepository.existsContactGroupAssignmentById(
          tx,
          contactGroupId
        );

      if (existsContactGroupAssignment) {
        const contactGroupAssignementId =
          await this.contactGroupAssignmentDeleterRepository.deleteContactGroupAssignmentById(
            tx,
            contactGroupId
          );

        if (!contactGroupAssignementId) {
          throw new Error(t('contact_group_assignment_deleter_error'));
        }
      }

      const updated =
        await this.contactGroupUpdaterRepository.updateContactGroupById(
          tx,
          contactGroupId,
          input
        );

      if (!updated) {
        throw new Error(t('contact_group_update_error'));
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
