import { injectable, inject } from 'tsyringe';
import { PermissionService } from '@core/services/permission.service';
import { ListPermissionGroupsResponse } from '@core/schema/permission/listPermissionGroups/response.schema';
import { ERouteModule } from '@core/common/enums/ERouteModule';

@injectable()
export class PermissionGroupsListerSelfUseCase {
  constructor(
    @inject(PermissionService)
    private readonly permissionService: PermissionService
  ) {}

  async execute(
    permissionRoleId: string
  ): Promise<ListPermissionGroupsResponse> {
    return this.permissionService.listPermissionGroupsByPermissionRoleId(
      permissionRoleId,
      ERouteModule.manager
    );
  }
}
