import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { PermissionService } from '@core/services/permission.service';
import { AssignUserRoleRequest } from '@core/schema/user/assignUserRole/request.schema';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';
import { isMasterOrAdministratorRole } from '@core/common/functions/isMasterOrAdministratorRole';

@injectable()
export class UserRoleAssignerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService,
    @inject(PermissionService)
    private readonly permissionService: PermissionService,
    @inject(PlanLimitEnforcementService)
    private readonly planLimitEnforcementService: PlanLimitEnforcementService
  ) {}

  private async validateUserExistsInAccount(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string
  ): Promise<void> {
    const existsUser = await this.userService.existsUserById(userId, accountId);

    if (!existsUser) {
      throw new Error(t('user_not_found'));
    }
  }

  private async validateUserExists(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<string> {
    const userAccountId = await this.userService.getUserAccountId(userId);

    if (!userAccountId) {
      throw new Error(t('user_not_found'));
    }

    return userAccountId;
  }

  private async validatePermissionRoleExists(
    t: TFunction<'translation', undefined>,
    permissionRoleId: string,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<void> {
    if (!canOperateOnOthers) {
      const existsPermissionRole =
        await this.permissionService.existsPermissionRoleById(
          accountId,
          permissionRoleId
        );

      if (!existsPermissionRole) {
        throw new Error(t('permission_role_not_found'));
      }
      return;
    }

    const permissionRoleAccountId =
      await this.permissionService.getPermissionRoleAccountId(permissionRoleId);

    if (!permissionRoleAccountId) {
      throw new Error(t('permission_role_not_found'));
    }
  }

  private async validateProtectedUserRoleUpdate(
    t: TFunction<'translation', undefined>,
    userId: string,
    currentUserId?: string,
    currentUserPermissionRoleId?: string
  ): Promise<void> {
    if (currentUserId && userId === currentUserId) {
      throw new Error(t('cannot_change_own_access_group'));
    }

    const targetUserRoleId = await this.userService.getUserRole(userId);

    if (targetUserRoleId === EPermissionRole.administrator) {
      throw new Error(t('permission_denied'));
    }

    if (targetUserRoleId === EPermissionRole.master) {
      if (currentUserPermissionRoleId !== EPermissionRole.administrator) {
        throw new Error(t('permission_denied'));
      }
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    input: AssignUserRoleRequest,
    canOperateOnOthers: boolean,
    currentUserId?: string,
    currentUserPermissionRoleId?: string
  ): Promise<boolean> {
    if (!canOperateOnOthers) {
      await this.validateUserExistsInAccount(t, userId, accountId);
    }

    let userAccountId: string | null = null;
    if (canOperateOnOthers) {
      userAccountId = await this.validateUserExists(t, userId);
    }

    const accountIdForValidation = canOperateOnOthers
      ? (userAccountId ?? accountId)
      : accountId;

    await this.validateProtectedUserRoleUpdate(
      t,
      userId,
      currentUserId,
      currentUserPermissionRoleId
    );

    await this.validatePermissionRoleExists(
      t,
      input.permission_role_id,
      accountIdForValidation,
      canOperateOnOthers
    );

    const assigned = await this.userService.assignUserRole(
      userId,
      input.permission_role_id
    );

    if (!assigned) {
      throw new Error(t('user_role_assignment_failed'));
    }

    if (isMasterOrAdministratorRole(input.permission_role_id)) {
      await this.planLimitEnforcementService.activateProtectedUserIfBlocked(
        accountIdForValidation,
        userId
      );
    }

    return true;
  }
}
