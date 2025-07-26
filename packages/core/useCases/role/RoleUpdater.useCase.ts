import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { RoleService } from '@core/services/role.service';

@injectable()
export class RoleUpdaterUseCase {
  constructor(private readonly roleService: RoleService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    roleId: number,
    body: string,
    accountId: number
  ): Promise<boolean> {
    const exists = await this.roleService.existsRoleById(roleId, accountId);

    if (!exists) {
      throw new Error(t('role_not_found'));
    }

    const roleUpdate = await this.roleService.updateRoleById(
      roleId,
      body,
      accountId
    );

    if (!roleUpdate) {
      throw new Error(t('role_update_error'));
    }

    return true;
  }
}
