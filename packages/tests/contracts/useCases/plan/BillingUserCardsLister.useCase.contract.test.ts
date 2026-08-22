import 'reflect-metadata';

jest.mock('@core/services/plan.service', () => ({
  PlanService: class {},
}));
jest.mock('@core/repositories/user/UserMasterViewer.repository', () => ({
  UserMasterViewerRepository: class {},
}));

import { BillingUserCardsListerUseCase } from '@core/useCases/plan/BillingUserCardsLister.useCase';

describe('BillingUserCardsListerUseCase', () => {
  it('lists saved cards for the same billing owner used by payments', async () => {
    const planService = {
      listUserCards: jest.fn(async () => [{ user_card_id: 'card-1' }]),
    };
    const userMasterViewerRepository = {
      findMasterUserByAccountId: jest.fn(async () => ({
        user_id: 'billing-owner-1',
      })),
    };
    const useCase = new BillingUserCardsListerUseCase(
      planService as never,
      userMasterViewerRepository as never
    );

    await expect(useCase.execute('account-1')).resolves.toEqual([
      { user_card_id: 'card-1' },
    ]);
    expect(planService.listUserCards).toHaveBeenCalledWith('billing-owner-1');
  });

  it('returns an empty list instead of using the requesting user when no owner exists', async () => {
    const planService = {
      listUserCards: jest.fn(),
    };
    const userMasterViewerRepository = {
      findMasterUserByAccountId: jest.fn(async () => null),
    };
    const useCase = new BillingUserCardsListerUseCase(
      planService as never,
      userMasterViewerRepository as never
    );

    await expect(useCase.execute('account-1')).resolves.toEqual([]);
    expect(planService.listUserCards).not.toHaveBeenCalled();
  });
});
