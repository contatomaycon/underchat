import 'reflect-metadata';

jest.mock(
  '@core/repositories/accountSettings/PlanRecurringUpdater.repository',
  () => ({
    PlanRecurringUpdaterRepository: class {},
  })
);
jest.mock('@core/repositories/plan/UserCardsLister.repository', () => ({
  UserCardsListerRepository: class {},
}));
jest.mock(
  '@core/repositories/plan/PlanCurrentInvoiceViewer.repository',
  () => ({
    PlanCurrentInvoiceViewerRepository: class {},
  })
);

import { PlanRecurringUpdaterUseCase } from '@core/useCases/accountSettings/PlanRecurringUpdater.useCase';

describe('PlanRecurringUpdaterUseCase', () => {
  it('updates recurring without card validation when recurring_payment is false', async () => {
    const recurringRepository = {
      updatePlanRecurring: jest.fn(async () => true),
    };
    const cardsRepository = {
      listUserCards: jest.fn(),
    };
    const invoiceRepository = {
      viewCurrentPlanInvoice: jest.fn(),
    };
    const useCase = new PlanRecurringUpdaterUseCase(
      recurringRepository as never,
      cardsRepository as never,
      invoiceRepository as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', 'user-1', {
        recurring_payment: false,
      } as never)
    ).resolves.toBe(true);
    expect(invoiceRepository.viewCurrentPlanInvoice).not.toHaveBeenCalled();
    expect(cardsRepository.listUserCards).not.toHaveBeenCalled();
    expect(recurringRepository.updatePlanRecurring).toHaveBeenCalledWith(
      'acc-1',
      false
    );
  });

  it('throws when recurring is enabled and current plan is missing', async () => {
    const recurringRepository = {
      updatePlanRecurring: jest.fn(),
    };
    const cardsRepository = {
      listUserCards: jest.fn(),
    };
    const invoiceRepository = {
      viewCurrentPlanInvoice: jest.fn(async () => null),
    };
    const useCase = new PlanRecurringUpdaterUseCase(
      recurringRepository as never,
      cardsRepository as never,
      invoiceRepository as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'user-1', {
        recurring_payment: true,
      } as never)
    ).rejects.toThrow('no_plan_found');
    expect(cardsRepository.listUserCards).not.toHaveBeenCalled();
    expect(recurringRepository.updatePlanRecurring).not.toHaveBeenCalled();
  });

  it('throws when recurring is enabled and no cards are available', async () => {
    const recurringRepository = {
      updatePlanRecurring: jest.fn(),
    };
    const cardsRepository = {
      listUserCards: jest.fn(async () => []),
    };
    const invoiceRepository = {
      viewCurrentPlanInvoice: jest.fn(async () => ({ plan_id: 'plan-1' })),
    };
    const useCase = new PlanRecurringUpdaterUseCase(
      recurringRepository as never,
      cardsRepository as never,
      invoiceRepository as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'user-1', {
        recurring_payment: true,
      } as never)
    ).rejects.toThrow('no_cards_found');
    expect(recurringRepository.updatePlanRecurring).not.toHaveBeenCalled();
  });

  it('throws when recurring is enabled and no default card exists', async () => {
    const recurringRepository = {
      updatePlanRecurring: jest.fn(),
    };
    const cardsRepository = {
      listUserCards: jest.fn(async () => [{ default: false }]),
    };
    const invoiceRepository = {
      viewCurrentPlanInvoice: jest.fn(async () => ({ plan_id: 'plan-1' })),
    };
    const useCase = new PlanRecurringUpdaterUseCase(
      recurringRepository as never,
      cardsRepository as never,
      invoiceRepository as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'user-1', {
        recurring_payment: true,
      } as never)
    ).rejects.toThrow('no_default_card_found');
    expect(recurringRepository.updatePlanRecurring).not.toHaveBeenCalled();
  });

  it('updates recurring when plan exists and default card is available', async () => {
    const recurringRepository = {
      updatePlanRecurring: jest.fn(async () => true),
    };
    const cardsRepository = {
      listUserCards: jest.fn(async () => [{ default: true }]),
    };
    const invoiceRepository = {
      viewCurrentPlanInvoice: jest.fn(async () => ({ plan_id: 'plan-1' })),
    };
    const useCase = new PlanRecurringUpdaterUseCase(
      recurringRepository as never,
      cardsRepository as never,
      invoiceRepository as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', 'user-1', {
        recurring_payment: true,
      } as never)
    ).resolves.toBe(true);
    expect(recurringRepository.updatePlanRecurring).toHaveBeenCalledWith(
      'acc-1',
      true
    );
  });
});
