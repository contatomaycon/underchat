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
    accountId: string,
    isAdministrator: boolean,
    input: AssignUserRoleRequest
  ): Promise<boolean> {
    const userAccountId = await this.userService.getUserAccountId(userId);

    if (!userAccountId) {
      throw new Error(t('user_not_found'));
    }

    const existsUser = await this.userService.existsUserById(
      userId,
      accountId,
      isAdministrator
    );

    if (!existsUser) {
      throw new Error(t('user_not_found'));
    }

    const existsPermissionRole =
      await this.permissionService.existsPermissionRoleById(
        userAccountId,
        input.permission_role_id,
        isAdministrator
      );

    if (!existsPermissionRole) {
      throw new Error(t('permission_role_not_found'));
    }

    const assigned = await this.userService.assignUserRole(
      userId,
      input.permission_role_id
    );

    if (!assigned) {
      throw new Error(t('user_role_assignment_failed'));
    }

    return true;
  }
}
