import 'reflect-metadata';

jest.mock(
  '@core/repositories/accountSettings/UserCardDeleter.repository',
  () => ({
    UserCardDeleterRepository: class {},
  })
);
jest.mock(
  '@core/repositories/accountSettings/PlanRecurringUpdater.repository',
  () => ({
    PlanRecurringUpdaterRepository: class {},
  })
);
jest.mock(
  '@core/repositories/plan/PlanCurrentInvoiceViewer.repository',
  () => ({
    PlanCurrentInvoiceViewerRepository: class {},
  })
);
jest.mock('@core/repositories/plan/UserCardsLister.repository', () => ({
  UserCardsListerRepository: class {},
}));
jest.mock(
  '@core/repositories/accountSettings/UserCardDefaultUpdater.repository',
  () => ({
    UserCardDefaultUpdaterRepository: class {},
  })
);

import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { UserCardDeleterUseCase } from '@core/useCases/accountSettings/UserCardDeleter.useCase';

describe('UserCardDeleterUseCase', () => {
  it('throws when target card does not exist', async () => {
    const userCardDeleterRepository = { deleteUserCard: jest.fn() };
    const recurringRepository = { updatePlanRecurring: jest.fn() };
    const invoiceRepository = {
      viewCurrentPlanInvoice: jest.fn(async () => null),
    };
    const cardsRepository = {
      listUserCards: jest.fn(async () => []),
    };
    const cardDefaultRepository = {
      setFirstCardAsDefault: jest.fn(),
    };
    const useCase = new UserCardDeleterUseCase(
      userCardDeleterRepository as never,
      recurringRepository as never,
      invoiceRepository as never,
      cardsRepository as never,
      cardDefaultRepository as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'card-1', 'user-1', 'acc-1')
    ).rejects.toThrow('card_not_found');
    expect(userCardDeleterRepository.deleteUserCard).not.toHaveBeenCalled();
  });

  it('throws when trying to remove last card of active recurring plan', async () => {
    const userCardDeleterRepository = { deleteUserCard: jest.fn() };
    const recurringRepository = { updatePlanRecurring: jest.fn() };
    const invoiceRepository = {
      viewCurrentPlanInvoice: jest.fn(async () => ({
        recurring_payment: true,
        cancellation_date: null,
        next_payment_date: null,
        account_status_id: EAccountStatus.active,
      })),
    };
    const cardsRepository = {
      listUserCards: jest.fn(async () => [
        { user_card_id: 'card-1', default: true },
      ]),
    };
    const cardDefaultRepository = {
      setFirstCardAsDefault: jest.fn(),
    };
    const useCase = new UserCardDeleterUseCase(
      userCardDeleterRepository as never,
      recurringRepository as never,
      invoiceRepository as never,
      cardsRepository as never,
      cardDefaultRepository as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'card-1', 'user-1', 'acc-1')
    ).rejects.toThrow('cannot_delete_last_card');
    expect(userCardDeleterRepository.deleteUserCard).not.toHaveBeenCalled();
  });

  it('throws when repository delete returns false', async () => {
    const userCardDeleterRepository = {
      deleteUserCard: jest.fn(async () => false),
    };
    const recurringRepository = { updatePlanRecurring: jest.fn() };
    const invoiceRepository = {
      viewCurrentPlanInvoice: jest.fn(async () => ({
        recurring_payment: false,
        cancellation_date: null,
        next_payment_date: null,
        account_status_id: EAccountStatus.active,
      })),
    };
    const cardsRepository = {
      listUserCards: jest.fn(async () => [
        { user_card_id: 'card-1', default: false },
      ]),
    };
    const cardDefaultRepository = {
      setFirstCardAsDefault: jest.fn(),
    };
    const useCase = new UserCardDeleterUseCase(
      userCardDeleterRepository as never,
      recurringRepository as never,
      invoiceRepository as never,
      cardsRepository as never,
      cardDefaultRepository as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'card-1', 'user-1', 'acc-1')
    ).rejects.toThrow('card_not_found');
  });

  it('sets first remaining card as default when deleting current default card', async () => {
    const userCardDeleterRepository = {
      deleteUserCard: jest.fn(async () => true),
    };
    const recurringRepository = {
      updatePlanRecurring: jest.fn(async () => true),
    };
    const invoiceRepository = {
      viewCurrentPlanInvoice: jest.fn(async () => ({
        recurring_payment: true,
        cancellation_date: '2025-01-01',
        next_payment_date: null,
        account_status_id: EAccountStatus.inactive,
      })),
    };
    const cardsRepository = {
      listUserCards: jest
        .fn()
        .mockResolvedValueOnce([
          { user_card_id: 'card-1', default: true },
          { user_card_id: 'card-2', default: false },
        ])
        .mockResolvedValueOnce([{ user_card_id: 'card-2', default: false }]),
    };
    const cardDefaultRepository = {
      setFirstCardAsDefault: jest.fn(async () => undefined),
    };
    const useCase = new UserCardDeleterUseCase(
      userCardDeleterRepository as never,
      recurringRepository as never,
      invoiceRepository as never,
      cardsRepository as never,
      cardDefaultRepository as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'card-1', 'user-1', 'acc-1')
    ).resolves.toBe(true);
    expect(cardDefaultRepository.setFirstCardAsDefault).toHaveBeenCalledWith(
      'user-1'
    );
    expect(recurringRepository.updatePlanRecurring).toHaveBeenCalledWith(
      'acc-1',
      false
    );
  });

  it('deletes non-default card without default update and keeps recurring untouched when false', async () => {
    const userCardDeleterRepository = {
      deleteUserCard: jest.fn(async () => true),
    };
    const recurringRepository = { updatePlanRecurring: jest.fn() };
    const invoiceRepository = {
      viewCurrentPlanInvoice: jest.fn(async () => ({
        recurring_payment: false,
        cancellation_date: null,
        next_payment_date: null,
        account_status_id: EAccountStatus.active,
      })),
    };
    const cardsRepository = {
      listUserCards: jest.fn(async () => [
        { user_card_id: 'card-1', default: false },
        { user_card_id: 'card-2', default: true },
      ]),
    };
    const cardDefaultRepository = {
      setFirstCardAsDefault: jest.fn(),
    };
    const useCase = new UserCardDeleterUseCase(
      userCardDeleterRepository as never,
      recurringRepository as never,
      invoiceRepository as never,
      cardsRepository as never,
      cardDefaultRepository as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'card-1', 'user-1', 'acc-1')
    ).resolves.toBe(true);
    expect(cardDefaultRepository.setFirstCardAsDefault).not.toHaveBeenCalled();
    expect(recurringRepository.updatePlanRecurring).not.toHaveBeenCalled();
  });

  it('returns false for cancelled plan when next payment date is in the future', () => {
    const useCase = new UserCardDeleterUseCase(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();

    expect(
      (useCase as any).checkIfPlanIsCancelled({
        cancellation_date: '2025-01-01',
        next_payment_date: futureDate,
        account_status_id: EAccountStatus.inactive,
      })
    ).toBe(false);
  });
});
