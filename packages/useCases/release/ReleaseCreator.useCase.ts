import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ReleaseService } from '@core/services/release.service';
import { CreateReleaseRequest } from '@core/schema/release/createRelease/request.schema';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';

@injectable()
export class ReleaseCreatorUseCase {
  constructor(private readonly releaseService: ReleaseService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateReleaseRequest,
    accountId: string | null,
    actions: IJwtGroupHierarchy[]
  ): Promise<string> {
    if (input.account_id !== null && input.account_id !== undefined) {
      const hasFullAccess = hasRequiredPermission(actions, [
        EGeneralPermissions.full_access,
        EGeneralPermissions.full_access_group,
      ]);

      if (!hasFullAccess) {
        throw new Error(t('release_create_account_permission_error'));
      }
    }

    const releaseId = await this.releaseService.createRelease(input, accountId);

    if (!releaseId) {
      throw new Error(t('release_create_error'));
    }

    return releaseId;
  }
}
