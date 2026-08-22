import 'reflect-metadata';

jest.mock('@core/common/exceptions/UserCardError', () => {
  class ArchivedUserCardNotFoundError extends Error {}

  return { ArchivedUserCardNotFoundError };
});
jest.mock(
  '@core/repositories/accountSettings/UserArchivedCards.repository',
  () => ({
    UserArchivedCardsRepository: class {},
  })
);
jest.mock('@core/repositories/user/UserMasterViewer.repository', () => ({
  UserMasterViewerRepository: class {},
}));

import { ArchivedUserCardNotFoundError } from '@core/common/exceptions/UserCardError';
import { UserCardReactivatorUseCase } from '@core/useCases/accountSettings/UserCardReactivator.useCase';

describe('UserCardReactivatorUseCase', () => {
  it('reactivates only a card belonging to the account billing owner', async () => {
    const userArchivedCardsRepository = {
      reactivateUserCard: jest.fn(async () => ({
        user_card_id: 'card-1',
        holder_name: 'John Doe',
        last_number: '1111',
        brand: 'visa',
        default: true,
        created_at: '2026-04-21T10:00:00.000Z',
      })),
    };
    const userMasterViewerRepository = {
      findMasterUserByAccountId: jest.fn(async () => ({
        user_id: 'billing-owner-1',
      })),
    };
    const useCase = new UserCardReactivatorUseCase(
      userArchivedCardsRepository as never,
      userMasterViewerRepository as never
    );

    await expect(useCase.execute('card-1', 'account-1')).resolves.toEqual(
      expect.objectContaining({ user_card_id: 'card-1' })
    );
    expect(userArchivedCardsRepository.reactivateUserCard).toHaveBeenCalledWith(
      'card-1',
      'billing-owner-1'
    );
  });

  it('does not reveal a card when the account has no billing owner', async () => {
    const userArchivedCardsRepository = {
      reactivateUserCard: jest.fn(),
    };
    const userMasterViewerRepository = {
      findMasterUserByAccountId: jest.fn(async () => null),
    };
    const useCase = new UserCardReactivatorUseCase(
      userArchivedCardsRepository as never,
      userMasterViewerRepository as never
    );

    await expect(useCase.execute('card-1', 'account-1')).rejects.toBeInstanceOf(
      ArchivedUserCardNotFoundError
    );
    expect(
      userArchivedCardsRepository.reactivateUserCard
    ).not.toHaveBeenCalled();
  });

  it('returns not found when the selected card is not archived for that owner', async () => {
    const userArchivedCardsRepository = {
      reactivateUserCard: jest.fn(async () => null),
    };
    const userMasterViewerRepository = {
      findMasterUserByAccountId: jest.fn(async () => ({
        user_id: 'billing-owner-1',
      })),
    };
    const useCase = new UserCardReactivatorUseCase(
      userArchivedCardsRepository as never,
      userMasterViewerRepository as never
    );

    await expect(
      useCase.execute('foreign-card', 'account-1')
    ).rejects.toBeInstanceOf(ArchivedUserCardNotFoundError);
  });
});
