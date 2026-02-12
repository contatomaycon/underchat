import { injectable, inject } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ReleaseService } from '@core/services/release.service';
import { ListReleaseFinalResponse } from '@core/schema/release/listRelease/response.schema';
import { ListReleaseRequest } from '@core/schema/release/listRelease/request.schema';

@injectable()
export class ReleaseListerUseCase {
  constructor(
    @inject(ReleaseService)
    private readonly releaseService: ReleaseService
  ) {}

  async execute(
    query: ListReleaseRequest,
    accountId: string,
    userId: string,
    permissionRoleId: string
  ): Promise<ListReleaseFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.releaseService.listReleases(
      perPage,
      currentPage,
      query,
      accountId,
      userId,
      permissionRoleId
    );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
