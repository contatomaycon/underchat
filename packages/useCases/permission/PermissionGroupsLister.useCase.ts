import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PermissionService } from '@core/services/permission.service';
import { ListPermissionGroupsResponse } from '@core/schema/permission/listPermissionGroups/response.schema';

@injectable()
export class PermissionGroupsListerUseCase {
  constructor(private readonly permissionService: PermissionService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ListPermissionGroupsResponse> {
    const result = await this.permissionService.listPermissionGroupsByUserId(
      userId,
      'manager'
    );

    return result;
  }
}
