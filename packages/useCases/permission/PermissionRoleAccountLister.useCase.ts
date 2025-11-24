import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PermissionService } from '@core/services/permission.service';
import { AccountService } from '@core/services/account.service';
import { ListRoleAccountResponse } from '@core/schema/sector/listSectorRoleAccount/response.schema';

@injectable()
export class PermissionRoleAccountListerUseCase {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ListRoleAccountResponse[]> {
    if (!isAdministrator) {
      const accountExists =
        await this.accountService.existsAccountById(accountId);

      if (!accountExists) {
        throw new Error(t('account_not_found'));
      }
    }

    return this.permissionService.listPermissionRoleAccountById(accountId);
  }
}
