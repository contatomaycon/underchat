import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { RoleService } from '@core/services/role.service';
import { ViewRoleResponse } from '@core/schema/role/viewRole/response.schema';

@injectable()
export class RoleViewerUseCase {
  constructor(private readonly roleService: RoleService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    roleId: string,
    accountId: string
  ): Promise<ViewRoleResponse | null> {
    const exists = await this.roleService.existsRoleById(roleId, accountId);

    if (!exists) {
      throw new Error(t('role_not_found'));
    }

    return this.roleService.viewRoleById(roleId, accountId);
  }
}
