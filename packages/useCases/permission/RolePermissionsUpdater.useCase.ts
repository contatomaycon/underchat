import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PermissionService } from '@core/services/permission.service';
import { PermissionGroupRequest } from '@core/schema/permission/updateRolePermissions/request.schema';

@injectable()
export class RolePermissionsUpdaterUseCase {
  constructor(private readonly permissionService: PermissionService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    permissionRoleId: string,
    groups: PermissionGroupRequest[],
    requesterAccountId: string,
    isAdministrator: boolean,
    currentUserPermissionRoleId: string
  ): Promise<void> {
    if (permissionRoleId === currentUserPermissionRoleId) {
      throw new Error(t('cannot_edit_own_role'));
    }

    const existsPermissionRole =
      await this.permissionService.existsPermissionRoleById(
        requesterAccountId,
        permissionRoleId,
        isAdministrator
      );

    if (!existsPermissionRole) {
      throw new Error(t('permission_role_not_found'));
    }

    await this.permissionService.updateRolePermissions(
      permissionRoleId,
      groups
    );
  }
}
