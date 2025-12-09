import { injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListContactGroupFinalResponse } from '@core/schema/contactGroup/listContactGroup/response.schema';
import { ListContactGroupRequest } from '@core/schema/contactGroup/listContactGroup/request.schema';
import { ContactGroupService } from '@core/services/contactGroup.service';

@injectable()
export class ContactGroupListerUseCase {
  constructor(private readonly contactGroupService: ContactGroupService) {}

  async execute(
    query: ListContactGroupRequest,
    accountId: string
  ): Promise<ListContactGroupFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.contactGroupService.listContactGroups(
      perPage,
      currentPage,
      query,
      accountId
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
