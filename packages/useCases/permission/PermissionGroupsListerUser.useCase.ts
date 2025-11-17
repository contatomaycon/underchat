import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PermissionService } from '@core/services/permission.service';
import { ListPermissionGroupsResponse } from '@core/schema/permission/listPermissionGroups/response.schema';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { UserService } from '@core/services/user.service';

@injectable()
export class PermissionGroupsListerUserUseCase {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly userService: UserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    requesterAccountId: string,
    targetUserId: string,
    isAdministrator: boolean
  ): Promise<ListPermissionGroupsResponse> {
    const existsUserById = await this.userService.existsUserById(
      targetUserId,
      requesterAccountId,
      isAdministrator
    );

    if (!existsUserById) {
      throw new Error(t('user_not_found'));
    }

    return this.permissionService.listPermissionGroupsByUserId(
      targetUserId,
      ERouteModule.manager
    );
  }
}
