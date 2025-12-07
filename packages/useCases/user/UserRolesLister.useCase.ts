import { injectable } from 'tsyringe';
import { PermissionService } from '@core/services/permission.service';
import { ListUserRolesResponse } from '@core/schema/user/listUserRoles/response.schema';

@injectable()
export class UserRolesListerUseCase {
  constructor(private readonly permissionService: PermissionService) {}

  async execute(accountId: string): Promise<ListUserRolesResponse> {
    return this.permissionService.listPermissionRoleAccountById(accountId);
  }
}
