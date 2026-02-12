import { injectable, inject } from 'tsyringe';
import { PermissionAssignmentUserViewerRepository } from '@core/repositories/permission/PermissionAssignmentUserViewer.repository';
import { PermissionRoleViewerExistsRepository } from '@core/repositories/permission/PermissionRoleViewerExists.repository';
import { PermissionRoleAccountListerRepository } from '@core/repositories/permission/PermissionRoleAccountLister.repository';
import { PermissionRoleAccountViewerRepository } from '@core/repositories/permission/PermissionRoleAccountViewer.repository';
import { PermissionGroupsListerRepository } from '@core/repositories/permission/PermissionGroupsLister.repository';
import { IRoleAccount } from '@core/common/interfaces/IRoleAccount';
import { ListPermissionGroupsResponse } from '@core/schema/permission/listPermissionGroups/response.schema';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { RolePermissionsUpdaterRepository } from '@core/repositories/permission/RolePermissionsUpdater.repository';
import { PermissionGroupRequest } from '@core/schema/permission/updateRolePermissions/request.schema';

@injectable()
export class PermissionService {
  constructor(
    @inject(PermissionAssignmentUserViewerRepository)
    private readonly permissionAssignmentUserViewerRepository: PermissionAssignmentUserViewerRepository,
    @inject(PermissionRoleViewerExistsRepository)
    private readonly permissionRoleViewerExistsRepository: PermissionRoleViewerExistsRepository,
    @inject(PermissionRoleAccountListerRepository)
    private readonly permissionRoleAccountListerRepository: PermissionRoleAccountListerRepository,
    @inject(PermissionRoleAccountViewerRepository)
    private readonly permissionRoleAccountViewerRepository: PermissionRoleAccountViewerRepository,
    @inject(PermissionGroupsListerRepository)
    private readonly permissionGroupsListerRepository: PermissionGroupsListerRepository,
    @inject(RolePermissionsUpdaterRepository)
    private readonly rolePermissionsUpdaterRepository: RolePermissionsUpdaterRepository
  ) {}

  viewPermissionByUserId = async (userId: string): Promise<string[]> => {
    const result =
      await this.permissionAssignmentUserViewerRepository.viewPermissionByUserId(
        userId
      );

    return result.map((item) => item.action);
  };

  existsPermissionRoleById = async (
    accountId: string,
    permissionRoleId: string
  ): Promise<boolean> => {
    return this.permissionRoleViewerExistsRepository.existsPermissionRoleById(
      accountId,
      permissionRoleId
    );
  };

  listPermissionRoleAccountById = async (
    accountId: string
  ): Promise<IRoleAccount[]> => {
    return this.permissionRoleAccountListerRepository.listPermissionRoleAccountById(
      accountId
    );
  };

  listPermissionGroupsByPermissionRoleId = async (
    permissionRoleId: string,
    moduleName: ERouteModule
  ): Promise<ListPermissionGroupsResponse> => {
    return this.permissionGroupsListerRepository.listPermissionGroupsByPermissionRoleId(
      permissionRoleId,
      moduleName
    );
  };

  updateRolePermissions = async (
    permissionRoleId: string,
    groups: PermissionGroupRequest[]
  ): Promise<void> => {
    return this.rolePermissionsUpdaterRepository.updateRolePermissions(
      permissionRoleId,
      groups
    );
  };

  getPermissionRoleAccountId = async (
    permissionRoleId: string
  ): Promise<string | null> => {
    return this.permissionRoleAccountViewerRepository.getPermissionRoleAccountId(
      permissionRoleId
    );
  };
}
