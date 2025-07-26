import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateRoleResponse } from '@core/schema/role/createServer/response.schema';
import { RoleService } from '@core/services/role.service';

@injectable()
export class RoleCreatorUseCase {
  constructor(private readonly roleService: RoleService) {}

  async validate(
    t: TFunction<'translation', undefined>,
    input: string,
    accountId: number
  ): Promise<void> {
    const roleExists = await this.roleService.existsRoleByName(
      input,
      accountId
    );

    if (roleExists) {
      throw new Error(t('role_already_exists'));
    }

    const totalRolesInUse =
      await this.roleService.totalRoleByAccount(accountId);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: string,
    accountId: number
  ): Promise<CreateRoleResponse | null> {
    await this.validate(t, input, accountId);

    const roleCreator = await this.roleService.createRole(input, accountId);

    if (!roleCreator) {
      throw new Error(t('role_creator_error'));
    }

    return roleCreator;
  }
}
