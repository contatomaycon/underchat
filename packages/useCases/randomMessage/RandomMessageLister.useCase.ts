import { inject, injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { RandomMessageService } from '@core/services/randomMessage.service';
import { ListRandomMessageRequest } from '@core/schema/randomMessage/listRandomMessage/request.schema';
import { ListRandomMessageFinalResponse } from '@core/schema/randomMessage/listRandomMessage/response.schema';

@injectable()
export class RandomMessageListerUseCase {
  constructor(
    @inject(RandomMessageService)
    private readonly randomMessageService: RandomMessageService
  ) {}

  async execute(
    query: ListRandomMessageRequest,
    accountId: string
  ): Promise<ListRandomMessageFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.randomMessageService.listRandomMessages(
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
