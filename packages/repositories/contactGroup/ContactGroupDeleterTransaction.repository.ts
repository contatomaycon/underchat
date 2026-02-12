import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { ContactGroupAssignmentDeleterRepository } from './ContactGroupAssignmentDeleter.repository';
import { ContactGroupAssignmentViewerExistsRepository } from './ContactGroupAssignmentViewerExists.repository';
import { ContactGroupDeleterRepository } from './ContactGroupDeleter.repository';

@injectable()
export class ContactGroupDeleterTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject(ContactGroupAssignmentDeleterRepository)
    private readonly contactGroupAssignmentDeleterRepository: ContactGroupAssignmentDeleterRepository,
    @inject(ContactGroupDeleterRepository)
    private readonly contactGroupDeleterRepository: ContactGroupDeleterRepository,
    @inject(ContactGroupAssignmentViewerExistsRepository)
    private readonly contactGroupAssignmentViewerExistsRepository: ContactGroupAssignmentViewerExistsRepository
  ) {}

  deleteContactGroup = async (
    t: TFunction<'translation', undefined>,
    contactGroupId: string
  ): Promise<boolean> => {
    await this.dbRw.transaction(async (tx) => {
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

      const contactGroupDeleted =
        await this.contactGroupDeleterRepository.deleteContactGroupById(
          tx,
          contactGroupId
        );

      if (!contactGroupDeleted) {
        throw new Error(t('contact_group_deleter_error'));
      }
    });

    return true;
  };
}
