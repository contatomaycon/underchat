import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { RandomMessageService } from '@core/services/randomMessage.service';
import { ViewRandomMessageResponse } from '@core/schema/randomMessage/viewRandomMessage/response.schema';

@injectable()
export class RandomMessageViewerUseCase {
  constructor(
    @inject(RandomMessageService)
    private readonly randomMessageService: RandomMessageService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    randomMessageId: string,
    accountId: string
  ): Promise<ViewRandomMessageResponse> {
    const randomMessage = await this.randomMessageService.viewRandomMessageById(
      randomMessageId,
      accountId
    );

    if (!randomMessage) {
      throw new Error(t('random_message_not_found'));
    }

    return randomMessage;
  }
}
