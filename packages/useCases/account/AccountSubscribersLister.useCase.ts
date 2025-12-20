import { injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { AccountService } from '@core/services/account.service';
import { ListAccountSubscribersFinalResponse } from '@core/schema/account/listAccountSubscribers/response.schema';
import { ListAccountSubscribersRequest } from '@core/schema/account/listAccountSubscribers/request.schema';

@injectable()
export class AccountSubscribersListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    query: ListAccountSubscribersRequest
  ): Promise<ListAccountSubscribersFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.accountService.listAccountSubscribers(
      perPage,
      currentPage,
      query
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
