import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { PermissionService } from '@core/services/permission.service';
import { AccountService } from '@core/services/account.service';
import { IRoleAccount } from '@core/common/interfaces/IRoleAccount';

@injectable()
export class PermissionRoleAccountListerUseCase {
  constructor(
    @inject(PermissionService)
    private readonly permissionService: PermissionService,
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<IRoleAccount[]> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    return this.permissionService.listPermissionRoleAccountById(accountId);
  }
}
