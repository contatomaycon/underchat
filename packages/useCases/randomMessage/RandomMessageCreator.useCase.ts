import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { RandomMessageService } from '@core/services/randomMessage.service';
import { CreateRandomMessageRequest } from '@core/schema/randomMessage/createRandomMessage/request.schema';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';

@injectable()
export class RandomMessageCreatorUseCase {
  constructor(
    @inject(RandomMessageService)
    private readonly randomMessageService: RandomMessageService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateRandomMessageRequest,
    accountId: string
  ): Promise<string> {
    const name = input.name?.trim();

    if (!name) {
      throw new Error(t('random_message_name_required'));
    }

    const status = input.status ?? ERandomMessageStatus.active;

    const randomMessageId = await this.randomMessageService.createRandomMessage(
      {
        account_id: accountId,
        name,
        status,
      }
    );

    if (!randomMessageId) {
      throw new Error(t('random_message_creation_failed'));
    }

    return randomMessageId;
  }
}
