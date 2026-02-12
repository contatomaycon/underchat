import { injectable, inject } from 'tsyringe';
import { ReleaseService } from '@core/services/release.service';
import { ListReleaseNotificationsResponse } from '@core/schema/release/listReleaseNotifications/response.schema';

@injectable()
export class ReleaseNotificationsListerUseCase {
  constructor(
    @inject(ReleaseService)
    private readonly releaseService: ReleaseService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    permissionRoleId: string
  ): Promise<ListReleaseNotificationsResponse> {
    return this.releaseService.listReleaseNotifications(
      accountId,
      userId,
      permissionRoleId
    );
  }
}
