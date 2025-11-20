import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { UserUpdaterRepository } from './UserUpdater.repository';
import { PermissionAssignmentDeleterRepository } from '../permission/PermissionAssignmentDeleter.repository';
import { IUpdateUser } from '@core/common/interfaces/IUpdateUser';

@injectable()
export class UserUpdaterTransactionRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    private readonly userUpdaterRepository: UserUpdaterRepository,
    private readonly permissionAssignmentDeleterRepository: PermissionAssignmentDeleterRepository
  ) {}

  updateUserWithAccountChange = async (
    t: TFunction<'translation', undefined>,
    userId: string,
    input: IUpdateUser,
    accountId: string,
    isAdministrator: boolean,
    currentAccountId: string | null
  ): Promise<boolean> => {
    return this.db.transaction(async (tx) => {
      const accountChanged =
        isAdministrator &&
        input.account_id &&
        currentAccountId !== input.account_id;

      if (accountChanged) {
        await this.permissionAssignmentDeleterRepository.deletePermissionAssignmentByUserIdTx(
          tx,
          userId
        );
      }

      const updateResult = await this.userUpdaterRepository.updateUserByIdTx(
        tx,
        userId,
        input,
        accountId,
        isAdministrator
      );

      if (!updateResult) {
        throw new Error(t('user_update_failed'));
      }

      return true;
    });
  };
}
