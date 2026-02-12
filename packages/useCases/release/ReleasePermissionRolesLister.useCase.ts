import { injectable, inject } from 'tsyringe';
import { ReleaseService } from '@core/services/release.service';
import { ListReleasePermissionRolesResponse } from '@core/schema/release/listReleasePermissionRoles/response.schema';

@injectable()
export class ReleasePermissionRolesListerUseCase {
  constructor(
    @inject(ReleaseService)
    private readonly releaseService: ReleaseService
  ) {}

  async execute(
    accountId: string
  ): Promise<ListReleasePermissionRolesResponse> {
    return this.releaseService.listReleasePermissionRoles(accountId);
  }
}
