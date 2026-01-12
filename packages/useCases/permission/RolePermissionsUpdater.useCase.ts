import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PermissionService } from '@core/services/permission.service';
import { PermissionGroupRequest } from '@core/schema/permission/updateRolePermissions/request.schema';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

@injectable()
export class RolePermissionsUpdaterUseCase {
  constructor(private readonly permissionService: PermissionService) {}

  private hasPermission(
    actions: IJwtGroupHierarchy[],
    permissionAction: string
  ): boolean {
    if (!actions?.length) {
      return false;
    }

    const hasFullAccess = actions.some(
      (action) =>
        action.action_name === EGeneralPermissions.full_access ||
        action.action_name === EGeneralPermissions.full_access_group
    );

    if (hasFullAccess) {
      return true;
    }

    return actions.some((action) => action.action_name === permissionAction);
  }

  private filterGroupsByPermissions(
    groups: PermissionGroupRequest[],
    userActions: IJwtGroupHierarchy[]
  ): PermissionGroupRequest[] {
    const filteredGroups: PermissionGroupRequest[] = [];

    for (const group of groups) {
      const hasGroupPermission = this.hasPermission(userActions, group.action);

      if (!hasGroupPermission) {
        const filteredPermissions = group.permissions.filter((permission) =>
          this.hasPermission(userActions, permission.action)
        );

        if (filteredPermissions.length > 0) {
          filteredGroups.push({
            ...group,
            selected: false,
            permissions: filteredPermissions,
          });
        }

        continue;
      }

      const filteredPermissions = group.permissions.filter((permission) =>
        this.hasPermission(userActions, permission.action)
      );

      filteredGroups.push({
        ...group,
        permissions: filteredPermissions,
      });
    }

    return filteredGroups;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    permissionRoleId: string,
    groups: PermissionGroupRequest[],
    requesterAccountId: string,
    currentUserPermissionRoleId: string,
    userActions: IJwtGroupHierarchy[]
  ): Promise<void> {
    if (permissionRoleId === currentUserPermissionRoleId) {
      throw new Error(t('cannot_edit_own_role'));
    }

    const existsPermissionRole =
      await this.permissionService.existsPermissionRoleById(
        requesterAccountId,
        permissionRoleId
      );

    if (!existsPermissionRole) {
      throw new Error(t('permission_role_not_found'));
    }

    const filteredGroups = this.filterGroupsByPermissions(groups, userActions);

    await this.permissionService.updateRolePermissions(
      permissionRoleId,
      filteredGroups
    );
  }
}
