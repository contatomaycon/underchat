import { UserArchivedCardsRepository } from '@core/repositories/accountSettings/UserArchivedCards.repository';
import { UserMasterViewerRepository } from '@core/repositories/user/UserMasterViewer.repository';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { inject, injectable } from 'tsyringe';

@injectable()
export class UserArchivedCardsListerUseCase {
  constructor(
    @inject(UserArchivedCardsRepository)
    private readonly userArchivedCardsRepository: UserArchivedCardsRepository,
    @inject(UserMasterViewerRepository)
    private readonly userMasterViewerRepository: UserMasterViewerRepository
  ) {}

  execute = async (accountId: string): Promise<ListUserCardResponse[]> => {
    const masterUser =
      await this.userMasterViewerRepository.findMasterUserByAccountId(
        accountId
      );

    if (!masterUser) {
      return [];
    }

    return this.userArchivedCardsRepository.listArchivedUserCards(
      masterUser.user_id
    );
  };
}
