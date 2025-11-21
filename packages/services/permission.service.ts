import { injectable } from 'tsyringe';
import { PermissionAssignmentUserViewerRepository } from '@core/repositories/permission/PermissionAssignmentUserViewer.repository';
import { PermissionRoleViewerExistsRepository } from '@core/repositories/permission/PermissionRoleViewerExists.repository';
import { PermissionRoleAccountListerRepository } from '@core/repositories/permission/PermissionRoleAccountLister.repository';
import { PermissionRoleAccountViewerRepository } from '@core/repositories/permission/PermissionRoleAccountViewer.repository';
import { ListRoleAccountResponse } from '@core/schema/sector/listSectorRoleAccount/response.schema';
import { PermissionRoleCountSectorViewerRepository } from '@core/repositories/permission/PermissionRoleCountSectorViewer.repository';
import { CreateSectorRoleRequest } from '@core/schema/sector/createSectorRole/request.schema';
import { PermissionGroupsListerRepository } from '@core/repositories/permission/PermissionGroupsLister.repository';
import { ListPermissionGroupsResponse } from '@core/schema/permission/listPermissionGroups/response.schema';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { RolePermissionsUpdaterRepository } from '@core/repositories/permission/RolePermissionsUpdater.repository';
import { PermissionGroupRequest } from '@core/schema/permission/updateRolePermissions/request.schema';

@injectable()
export class PermissionService {
  constructor(
    private readonly permissionAssignmentUserViewerRepository: PermissionAssignmentUserViewerRepository,
    private readonly permissionRoleViewerExistsRepository: PermissionRoleViewerExistsRepository,
    private readonly permissionRoleAccountListerRepository: PermissionRoleAccountListerRepository,
    private readonly permissionRoleAccountViewerRepository: PermissionRoleAccountViewerRepository,
    private readonly permissionRoleCountSectorViewerRepository: PermissionRoleCountSectorViewerRepository,
    private readonly permissionGroupsListerRepository: PermissionGroupsListerRepository,
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
    permissionRoleId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    return this.permissionRoleViewerExistsRepository.existsPermissionRoleById(
      accountId,
      permissionRoleId,
      isAdministrator
    );
  };

  listPermissionRoleAccountById = async (
    accountId: string
  ): Promise<ListRoleAccountResponse[]> => {
    return this.permissionRoleAccountListerRepository.listPermissionRoleAccountById(
      accountId
    );
  };

  countRolesSector = async (
    accountId: string,
    rolesId: CreateSectorRoleRequest
  ): Promise<boolean> => {
    return this.permissionRoleCountSectorViewerRepository.countRolesSector(
      accountId,
      rolesId
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
