import { injectable } from 'tsyringe';
import { PermissionAssignmentUserViewerRepository } from '@core/repositories/permission/PermissionAssignmentUserViewer.repository';
import { PermissionRoleViewerExistsRepository } from '@core/repositories/permission/PermissionRoleViewerExists.repository';
import { PermissionRoleAccountListerRepository } from '@core/repositories/permission/PermissionRoleAccountViewer.repository';
import { ListRoleAccountResponse } from '@core/schema/sector/listSectorRoleAccount/response.schema';
import { PermissionRoleCountSectorViewerRepository } from '@core/repositories/permission/PermissionRoleCountSectorViewer.repository';
import { CreateSectorRoleRequest } from '@core/schema/sector/createSectorRole/request.schema';

@injectable()
export class PermissionService {
  constructor(
    private readonly permissionAssignmentUserViewerRepository: PermissionAssignmentUserViewerRepository,
    private readonly permissionRoleViewerExistsRepository: PermissionRoleViewerExistsRepository,
    private readonly permissionRoleAccountListerRepository: PermissionRoleAccountListerRepository,
    private readonly permissionRoleCountSectorViewerRepository: PermissionRoleCountSectorViewerRepository
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
  ): Promise<ListRoleAccountResponse[] | null> => {
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
}
