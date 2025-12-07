import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserCardDefaultUpdaterRepository } from '@core/repositories/accountSettings/UserCardDefaultUpdater.repository';
import { UserCardsListerRepository } from '@core/repositories/plan/UserCardsLister.repository';

@injectable()
export class UserCardDefaultUpdaterUseCase {
  constructor(
    @inject(UserCardDefaultUpdaterRepository)
    private readonly userCardDefaultUpdaterRepository: UserCardDefaultUpdaterRepository,
    @inject(UserCardsListerRepository)
    private readonly userCardsListerRepository: UserCardsListerRepository
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    userCardId: string,
    userId: string
  ): Promise<void> => {
    const card = await this.userCardsListerRepository.getUserCardById(
      userCardId,
      userId
    );

    if (!card) {
      throw new Error(t('card_not_found'));
    }

    await this.userCardDefaultUpdaterRepository.updateUserCardDefault(
      userCardId,
      userId
    );
  };
}
