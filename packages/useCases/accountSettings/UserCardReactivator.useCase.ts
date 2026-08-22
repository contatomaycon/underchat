import { ArchivedUserCardNotFoundError } from '@core/common/exceptions/UserCardError';
import { UserArchivedCardsRepository } from '@core/repositories/accountSettings/UserArchivedCards.repository';
import { UserMasterViewerRepository } from '@core/repositories/user/UserMasterViewer.repository';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { inject, injectable } from 'tsyringe';

@injectable()
export class UserCardReactivatorUseCase {
  constructor(
    @inject(UserArchivedCardsRepository)
    private readonly userArchivedCardsRepository: UserArchivedCardsRepository,
    @inject(UserMasterViewerRepository)
    private readonly userMasterViewerRepository: UserMasterViewerRepository
  ) {}

  execute = async (
    userCardId: string,
    accountId: string
  ): Promise<ListUserCardResponse> => {
    const masterUser =
      await this.userMasterViewerRepository.findMasterUserByAccountId(
        accountId
      );

    if (!masterUser) {
      throw new ArchivedUserCardNotFoundError();
    }

    const userCard = await this.userArchivedCardsRepository.reactivateUserCard(
      userCardId,
      masterUser.user_id
    );

    if (!userCard) {
      throw new ArchivedUserCardNotFoundError();
    }

    return userCard;
  };
}
