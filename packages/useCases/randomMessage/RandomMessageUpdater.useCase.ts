import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { RandomMessageService } from '@core/services/randomMessage.service';
import { UpdateRandomMessageRequest } from '@core/schema/randomMessage/updateRandomMessage/request.schema';

@injectable()
export class RandomMessageUpdaterUseCase {
  constructor(
    @inject(RandomMessageService)
    private readonly randomMessageService: RandomMessageService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    randomMessageId: string,
    accountId: string,
    input: UpdateRandomMessageRequest
  ): Promise<boolean> {
    const randomMessage = await this.randomMessageService.viewRandomMessageById(
      randomMessageId,
      accountId
    );

    if (!randomMessage) {
      throw new Error(t('random_message_not_found'));
    }

    const updated = await this.randomMessageService.updateRandomMessageById({
      random_message_id: randomMessageId,
      account_id: accountId,
      name: input.name,
      status: input.status,
    });

    if (!updated) {
      throw new Error(t('random_message_update_error'));
    }

    return updated;
  }
}
