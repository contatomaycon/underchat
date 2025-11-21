import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { PermissionService } from '@core/services/permission.service';
import { ListRoleAccountResponse } from '@core/schema/sector/listSectorRoleAccount/response.schema';

@injectable()
export class SectorRoleAccountListerUseCase {
  constructor(
    private readonly accountService: AccountService,
    private readonly permissionService: PermissionService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ListRoleAccountResponse[] | null> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    return this.permissionService.listPermissionRoleAccountById(accountId);
  }
}
