import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { RoleService } from '@core/services/role.service';

@injectable()
export class RoleDeleterUseCase {
  constructor(private readonly roleService: RoleService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    roleId: string,
    accountId: string
  ): Promise<boolean> {
    const exists = await this.roleService.existsRoleById(roleId, accountId);

    if (!exists) {
      throw new Error(t('role_not_found'));
    }

    const deleteRoleById = await this.roleService.deleteRoleById(
      roleId,
      accountId
    );

    if (!deleteRoleById) {
      throw new Error(t('role_deleter_error'));
    }

    return true;
  }
}
