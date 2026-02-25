import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { RandomMessageService } from '@core/services/randomMessage.service';

@injectable()
export class RandomMessageItemDeleterUseCase {
  constructor(
    @inject(RandomMessageService)
    private readonly randomMessageService: RandomMessageService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    randomMessageId: string,
    randomMessageItemId: string,
    accountId: string
  ): Promise<boolean> {
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

    const deleted = await this.randomMessageService.deleteRandomMessageItemById(
      randomMessageItemId,
      randomMessageId,
      accountId
    );

    if (!deleted) {
      throw new Error(t('random_message_item_deleter_error'));
    }

    return deleted;
  }
}
