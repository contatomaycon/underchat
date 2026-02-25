import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { RandomMessageService } from '@core/services/randomMessage.service';
import { ViewRandomMessageItemResponse } from '@core/schema/randomMessage/viewRandomMessageItem/response.schema';

@injectable()
export class RandomMessageItemViewerUseCase {
  constructor(
    @inject(RandomMessageService)
    private readonly randomMessageService: RandomMessageService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    randomMessageId: string,
    randomMessageItemId: string,
    accountId: string
  ): Promise<ViewRandomMessageItemResponse> {
    const randomMessage = await this.randomMessageService.viewRandomMessageById(
      randomMessageId,
      accountId
    );

    if (!randomMessage) {
      throw new Error(t('random_message_not_found'));
    }

    const randomMessageItem =
      await this.randomMessageService.viewRandomMessageItemById(
        randomMessageItemId,
        randomMessageId,
        accountId
      );

    if (!randomMessageItem) {
      throw new Error(t('random_message_item_not_found'));
    }

    return randomMessageItem;
  }
}
