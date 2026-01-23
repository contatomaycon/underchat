import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ReleaseService } from '@core/services/release.service';
import { ListReleaseAccountsResponse } from '@core/schema/release/listReleaseAccounts/response.schema';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';

@injectable()
export class ReleaseAccountsListerUseCase {
  constructor(private readonly releaseService: ReleaseService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    actions: IJwtGroupHierarchy[]
  ): Promise<ListReleaseAccountsResponse> {
    const hasFullAccess = hasRequiredPermission(actions, [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
    ]);

    if (!hasFullAccess) {
      throw new Error(t('release_accounts_permission_error'));
    }

    return this.releaseService.listReleaseAccounts();
  }
}
