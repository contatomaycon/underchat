import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ReleaseService } from '@core/services/release.service';
import { CreateReleaseRequest } from '@core/schema/release/createRelease/request.schema';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EReleaseType } from '@core/common/enums/EReleaseType';

@injectable()
export class ReleaseCreatorUseCase {
  constructor(
    @inject(ReleaseService)
    private readonly releaseService: ReleaseService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateReleaseRequest,
    accountId: string | null,
    userId: string,
    actions: IJwtGroupHierarchy[]
  ): Promise<string> {
    const hasFullAccess = hasRequiredPermission(actions, [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
    ]);

    const isForAccount =
      input.account_id !== null &&
      input.account_id !== undefined &&
      (input.user_id === null || input.user_id === undefined) &&
      (input.permission_role_id === null ||
        input.permission_role_id === undefined);

    if (isForAccount && !hasFullAccess) {
      throw new Error(t('release_create_account_permission_error'));
    }

    if (input.type === EReleaseType.reminder && !input.reminder_at) {
      throw new Error(t('release_reminder_datetime_required'));
    }

    const releaseId = await this.releaseService.createRelease(
      input,
      accountId,
      accountId,
      hasFullAccess,
      userId
    );

    if (!releaseId) {
      throw new Error(t('release_create_error'));
    }

    return releaseId;
  }
}
