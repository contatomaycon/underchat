import 'reflect-metadata';

jest.mock('@core/services/planAccountCancellation.service', () => ({
  PlanAccountCancellationService: class {},
}));

import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { PlanAccountCancellerUseCase } from '@core/useCases/accountSettings/PlanAccountCanceller.useCase';

describe('PlanAccountCancellerUseCase', () => {
  it('delegates account cancellation to service', async () => {
    const responseMessage = 'cancelled';
    const service = {
      cancelPlanAccount: jest.fn(async () => responseMessage),
    };
    const useCase = new PlanAccountCancellerUseCase(service as never);
    const t = jest.fn((key: string) => key);
    const tokenData = { account_id: 'acc-1', user_id: 'user-1' } as never;

    await expect(useCase.execute(t as never, tokenData)).resolves.toBe(
      responseMessage
    );
    expect(service.cancelPlanAccount).toHaveBeenCalledWith(
      t,
      'acc-1',
      EAccountStatus.inactive,
      tokenData
    );
  });
});
