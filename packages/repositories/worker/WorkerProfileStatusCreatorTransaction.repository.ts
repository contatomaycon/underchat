import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { WorkerProfileStatusCreatorRepository } from './WorkerProfileStatusCreator.repository';
import { WorkerProfileStatusContactCreatorRepository } from './WorkerProfileStatusContactCreator.repository';
import { WorkerProfileStatusContactDeleterRepository } from './WorkerProfileStatusContactDeleter.repository';
import { ContactListerByAccountRepository } from '../contact/ContactListerByAccount.repository';
import { ContactListerByGroupRepository } from '../contact/ContactListerByGroup.repository';
import { ICreateWorkerProfileStatus } from '@core/common/interfaces/ICreateWorkerProfileStatus';
import { IVisibilityData } from '@core/common/interfaces/IVisibilityData';

@injectable()
export class WorkerProfileStatusCreatorTransactionRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>,
    private readonly workerProfileStatusCreatorRepository: WorkerProfileStatusCreatorRepository,
    private readonly workerProfileStatusContactCreatorRepository: WorkerProfileStatusContactCreatorRepository,
    private readonly workerProfileStatusContactDeleterRepository: WorkerProfileStatusContactDeleterRepository,
    private readonly contactListerByAccountRepository: ContactListerByAccountRepository,
    private readonly contactListerByGroupRepository: ContactListerByGroupRepository
  ) {}

  createWorkerProfileStatus = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: ICreateWorkerProfileStatus,
    visibilityData: IVisibilityData
  ): Promise<string> => {
    return this.db.transaction(async (tx) => {
      const workerProfileStatusId =
        await this.workerProfileStatusCreatorRepository.createWorkerProfileStatus(
          tx,
          input
        );

      if (!workerProfileStatusId) {
        throw new Error(t('profile_status_creation_failed'));
      }

      await this.workerProfileStatusContactDeleterRepository.deleteWorkerProfileStatusContactByStatusId(
        tx,
        workerProfileStatusId
      );

      let contactIds: string[] = [];

      if (visibilityData.visibility_type === 'all') {
        contactIds =
          await this.contactListerByAccountRepository.listContactsByAccountId(
            accountId
          );
      }

      if (visibilityData.visibility_type === 'contact_groups') {
        if (!visibilityData.contact_group_ids?.length) {
          throw new Error(t('contact_groups_required'));
        }

        contactIds =
          await this.contactListerByGroupRepository.listContactsByGroupIds(
            accountId,
            visibilityData.contact_group_ids
          );
      }

      if (visibilityData.visibility_type === 'contacts') {
        if (!visibilityData.contact_ids?.length) {
          throw new Error(t('contacts_required'));
        }

        contactIds = visibilityData.contact_ids;
      }

      await Promise.all(
        contactIds.map((contactId) =>
          this.workerProfileStatusContactCreatorRepository.createWorkerProfileStatusContact(
            tx,
            workerProfileStatusId,
            contactId
          )
        )
      );

      return workerProfileStatusId;
    });
  };
}
