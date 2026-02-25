import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { RandomMessageService } from '@core/services/randomMessage.service';

@injectable()
export class RandomMessageDeleterUseCase {
  constructor(
    @inject(RandomMessageService)
    private readonly randomMessageService: RandomMessageService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    randomMessageId: string,
    accountId: string
  ): Promise<boolean> {
    const randomMessage = await this.randomMessageService.viewRandomMessageById(
      randomMessageId,
      accountId
    );

    if (!randomMessage) {
      throw new Error(t('random_message_not_found'));
    }

    const deleted = await this.randomMessageService.deleteRandomMessageById(
      randomMessageId,
      accountId
    );

    if (!deleted) {
      throw new Error(t('random_message_deleter_error'));
    }

    return deleted;
  }
}
