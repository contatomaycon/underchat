import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PermissionService } from '@core/services/permission.service';
import { ListPermissionGroupsResponse } from '@core/schema/permission/listPermissionGroups/response.schema';
import { ERouteModule } from '@core/common/enums/ERouteModule';

@injectable()
export class PermissionGroupsListerUserUseCase {
  constructor(private readonly permissionService: PermissionService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    requesterAccountId: string,
    permissionRoleId: string
  ): Promise<ListPermissionGroupsResponse> {
    const existsPermissionRole =
      await this.permissionService.existsPermissionRoleById(
        requesterAccountId,
        permissionRoleId
      );

    if (!existsPermissionRole) {
      throw new Error(t('permission_role_not_found'));
    }

    return this.permissionService.listPermissionGroupsByPermissionRoleId(
      permissionRoleId,
      ERouteModule.manager
    );
  }
}
