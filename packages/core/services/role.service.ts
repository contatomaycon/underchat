import { injectable } from 'tsyringe';
import { ListRoleResponse } from '@core/schema/role/listRole/response.schema';
import { ListRoleRequest } from '@core/schema/role/listRole/request.schema';
import { RoleListerRepository } from '@core/repositories/role/RoleLister.repository';
import { RoleViewerExistsRepository } from '@core/repositories/role/RoleViewerExists.repository';
import { RoleViewerRepository } from '@core/repositories/role/RoleViewer.repository';
import { ViewRoleResponse } from '@core/schema/role/viewRole/response.schema';
import { RoleDeleterRepository } from '@core/repositories/role/RoleDeleter.repository';
import { RoleUpdaterRepository } from '@core/repositories/role/RoleUpdater.repository';
import { RoleViewerNameExistsRepository } from '@core/repositories/role/RoleViewerNameExists.repository';
import { RoleCreatorRepository } from '@core/repositories/role/RoleCreator.repository';
import { CreateRoleResponse } from '@core/schema/role/createServer/response.schema';
import { RoleTotalViewerRepository } from '@core/repositories/role/RoleTotalViewer.repository';

@injectable()
export class RoleService {
  constructor(
    private readonly roleListerRepository: RoleListerRepository,
    private readonly roleViewerExistsRepository: RoleViewerExistsRepository,
    private readonly roleViewerRepository: RoleViewerRepository,
    private readonly roleDeleterRepository: RoleDeleterRepository,
    private readonly roleUpdaterRepository: RoleUpdaterRepository,
    private readonly roleViewerNameExistsRepository: RoleViewerNameExistsRepository,
    private readonly roleCreatorRepository: RoleCreatorRepository,
    private readonly roleTotalViewerRepository: RoleTotalViewerRepository
  ) {}

  listRoles = async (
    perPage: number,
    currentPage: number,
    query: ListRoleRequest,
    accountId: number
  ): Promise<[ListRoleResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.roleListerRepository.listRoles(
        perPage,
        currentPage,
        query,
        accountId
      ),
      this.roleListerRepository.listRolesTotal(query, accountId),
    ]);

    return [result, total];
  };

  existsRoleById = async (
    roleId: number,
    accountId: number
  ): Promise<boolean> => {
    return this.roleViewerExistsRepository.existsRoleById(roleId, accountId);
  };

  existsRoleByName = async (
    roleName: string,
    accountId: number
  ): Promise<boolean> => {
    return this.roleViewerNameExistsRepository.existsRoleByName(
      roleName,
      accountId
    );
  };

  viewRoleById = async (
    roleId: number,
    accountId: number
  ): Promise<ViewRoleResponse | null> => {
    return this.roleViewerRepository.viewRoleById(roleId, accountId);
  };

  deleteRoleById = async (
    roleId: number,
    accountId: number
  ): Promise<boolean> => {
    return this.roleDeleterRepository.deleteRoleById(roleId, accountId);
  };

  updateRoleById = async (
    roleId: number,
    roleName: string,
    accountId: number
  ): Promise<number | null> => {
    return this.roleUpdaterRepository.updateRoleById(
      roleId,
      roleName,
      accountId
    );
  };

  createRole = async (
    roleName: string,
    accountId: number
  ): Promise<CreateRoleResponse | null> => {
    return this.roleCreatorRepository.createRole(roleName, accountId);
  };

  totalRoleByAccount = async (accountId: number): Promise<number | null> => {
    return this.roleTotalViewerRepository.totalRoleByAccount(accountId);
  };
}
