import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ReleaseService } from '@core/services/release.service';
import { ViewReleaseResponse } from '@core/schema/release/viewRelease/response.schema';

@injectable()
export class ReleaseViewerUseCase {
  constructor(private readonly releaseService: ReleaseService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    releaseId: string,
    accountId: string,
    userId: string,
    permissionRoleId: string
  ): Promise<ViewReleaseResponse | null> {
    const viewRelease = await this.releaseService.viewRelease(
      releaseId,
      accountId,
      userId,
      permissionRoleId
    );

    if (!viewRelease) {
      throw new Error(t('release_not_found'));
    }

    return viewRelease;
  }
}
