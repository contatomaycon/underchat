import { injectable } from 'tsyringe';
import { ReleaseService } from '@core/services/release.service';
import { ListReleaseUsersResponse } from '@core/schema/release/listReleaseUsers/response.schema';

@injectable()
export class ReleaseUsersListerUseCase {
  constructor(private readonly releaseService: ReleaseService) {}

  async execute(accountId: string): Promise<ListReleaseUsersResponse> {
    return this.releaseService.listReleaseUsers(accountId);
  }
}
