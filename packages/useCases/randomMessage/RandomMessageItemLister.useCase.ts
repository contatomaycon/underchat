import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { RandomMessageService } from '@core/services/randomMessage.service';
import { ListRandomMessageItemFinalResponse } from '@core/schema/randomMessage/listRandomMessageItem/response.schema';
import { ListRandomMessageItemQueryRequest } from '@core/schema/randomMessage/listRandomMessageItem/request.schema';

@injectable()
export class RandomMessageItemListerUseCase {
  constructor(
    @inject(RandomMessageService)
    private readonly randomMessageService: RandomMessageService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    randomMessageId: string,
    query: ListRandomMessageItemQueryRequest,
    accountId: string
  ): Promise<ListRandomMessageItemFinalResponse> {
    const randomMessage = await this.randomMessageService.viewRandomMessageById(
      randomMessageId,
      accountId
    );

    if (!randomMessage) {
      throw new Error(t('random_message_not_found'));
    }

    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] =
      await this.randomMessageService.listRandomMessageItems(
        perPage,
        currentPage,
        query,
        randomMessageId,
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
