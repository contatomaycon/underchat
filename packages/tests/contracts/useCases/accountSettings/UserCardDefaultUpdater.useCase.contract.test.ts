import 'reflect-metadata';

jest.mock(
  '@core/repositories/accountSettings/UserCardDefaultUpdater.repository',
  () => ({
    UserCardDefaultUpdaterRepository: class {},
  })
);
jest.mock('@core/repositories/plan/UserCardsLister.repository', () => ({
  UserCardsListerRepository: class {},
}));

import { UserCardDefaultUpdaterUseCase } from '@core/useCases/accountSettings/UserCardDefaultUpdater.useCase';

describe('UserCardDefaultUpdaterUseCase', () => {
  it('throws when card does not exist for user', async () => {
    const defaultUpdaterRepository = {
      updateUserCardDefault: jest.fn(),
    };
    const cardsRepository = {
      getUserCardById: jest.fn(async () => null),
    };
    const useCase = new UserCardDefaultUpdaterUseCase(
      defaultUpdaterRepository as never,
      cardsRepository as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'card-1', 'user-1')
    ).rejects.toThrow('card_not_found');
    expect(
      defaultUpdaterRepository.updateUserCardDefault
    ).not.toHaveBeenCalled();
  });

  it('updates card default when card exists', async () => {
    const defaultUpdaterRepository = {
      updateUserCardDefault: jest.fn(async () => undefined),
    };
    const cardsRepository = {
      getUserCardById: jest.fn(async () => ({ user_card_id: 'card-1' })),
    };
    const useCase = new UserCardDefaultUpdaterUseCase(
      defaultUpdaterRepository as never,
      cardsRepository as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'card-1', 'user-1')
    ).resolves.toBeUndefined();
    expect(defaultUpdaterRepository.updateUserCardDefault).toHaveBeenCalledWith(
      'card-1',
      'user-1'
    );
  });
});
