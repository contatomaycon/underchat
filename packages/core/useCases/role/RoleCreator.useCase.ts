import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { RoleService } from '@core/services/role.service';
import { CreateRoleResponse } from '@core/schema/role/createRole/response.schema';
import { AccountService } from '@core/services/account.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

@injectable()
export class RoleCreatorUseCase {
  constructor(
    private readonly roleService: RoleService,
    private readonly accountService: AccountService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    input: string,
    accountId: string
  ): Promise<void> {
    const roleExists = await this.roleService.existsRoleByName(
      input,
      accountId
    );

    if (roleExists) {
      throw new Error(t('role_already_exists'));
    }

    const [viewAccountQuantityProduct, totalRoleByAccountId] =
      await Promise.all([
        this.accountService.viewAccountQuantityProduct(
          accountId,
          EPlanProduct.role
        ),
        this.roleService.totalRoleByAccount(accountId),
      ]);

    if (viewAccountQuantityProduct <= 0) {
      throw new Error(t('role_not_available'));
    }

    if (totalRoleByAccountId >= viewAccountQuantityProduct) {
      throw new Error(t('role_not_available_additional'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: string,
    accountId: string
  ): Promise<CreateRoleResponse | null> {
    await this.validate(t, input, accountId);

    const roleCreator = await this.roleService.createRole(input, accountId);

    if (!roleCreator) {
      throw new Error(t('role_creator_error'));
    }

    return roleCreator;
  }
}
