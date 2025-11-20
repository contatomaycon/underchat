import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { PermissionService } from '@core/services/permission.service';
import { AssignUserRoleRequest } from '@core/schema/user/assignUserRole/request.schema';

@injectable()
export class UserRoleAssignerUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly permissionService: PermissionService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    isAdministrator: boolean,
    input: AssignUserRoleRequest
  ): Promise<boolean> {
    const existsUser = await this.userService.existsUserById(
      userId,
      input.account_id,
      isAdministrator
    );

    if (!existsUser) {
      throw new Error(t('user_not_found'));
    }

    const existsPermissionRole =
      await this.permissionService.existsPermissionRoleById(
        input.account_id,
        input.permission_role_id,
        isAdministrator
      );

    if (!existsPermissionRole) {
      throw new Error(t('permission_role_not_found'));
    }

    const roleAccountId = await this.permissionService.getPermissionRoleAccountId(
      input.permission_role_id
    );

    if (!roleAccountId) {
      throw new Error(t('permission_role_not_found'));
    }

    if (roleAccountId !== input.account_id) {
      throw new Error(t('role_does_not_belong_to_user_account'));
    }

    const assigned = await this.userService.assignUserRole(
      userId,
      input.permission_role_id,
      input.account_id
    );

    if (!assigned) {
      throw new Error(t('user_role_assignment_failed'));
    }

    return true;
  }
}

