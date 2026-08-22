import 'reflect-metadata';

jest.mock(
  '@core/repositories/accountSettings/UserArchivedCards.repository',
  () => ({
    UserArchivedCardsRepository: class {},
  })
);
jest.mock('@core/repositories/user/UserMasterViewer.repository', () => ({
  UserMasterViewerRepository: class {},
}));

import { UserArchivedCardsListerUseCase } from '@core/useCases/accountSettings/UserArchivedCardsLister.useCase';

describe('UserArchivedCardsListerUseCase', () => {
  it('lists archived cards for the account billing owner instead of the caller', async () => {
    const userArchivedCardsRepository = {
      listArchivedUserCards: jest.fn(async () => [{ user_card_id: 'card-1' }]),
    };
    const userMasterViewerRepository = {
      findMasterUserByAccountId: jest.fn(async () => ({
        user_id: 'billing-owner-1',
      })),
    };
    const useCase = new UserArchivedCardsListerUseCase(
      userArchivedCardsRepository as never,
      userMasterViewerRepository as never
    );

    await expect(useCase.execute('account-1')).resolves.toEqual([
      { user_card_id: 'card-1' },
    ]);
    expect(
      userMasterViewerRepository.findMasterUserByAccountId
    ).toHaveBeenCalledWith('account-1');
    expect(
      userArchivedCardsRepository.listArchivedUserCards
    ).toHaveBeenCalledWith('billing-owner-1');
  });

  it('does not query cards when the account has no billing owner', async () => {
    const userArchivedCardsRepository = {
      listArchivedUserCards: jest.fn(),
    };
    const userMasterViewerRepository = {
      findMasterUserByAccountId: jest.fn(async () => null),
    };
    const useCase = new UserArchivedCardsListerUseCase(
      userArchivedCardsRepository as never,
      userMasterViewerRepository as never
    );

    await expect(useCase.execute('account-1')).resolves.toEqual([]);
    expect(
      userArchivedCardsRepository.listArchivedUserCards
    ).not.toHaveBeenCalled();
  });
});
