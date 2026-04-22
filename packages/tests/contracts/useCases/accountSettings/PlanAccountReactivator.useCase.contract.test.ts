import 'reflect-metadata';

jest.mock('@core/services/planAccountCancellation.service', () => ({
  PlanAccountCancellationService: class {},
}));

import { PlanAccountReactivatorUseCase } from '@core/useCases/accountSettings/PlanAccountReactivator.useCase';

describe('PlanAccountReactivatorUseCase', () => {
  it('delegates plan account reactivation to service', async () => {
    const service = {
      reactivatePlanAccount: jest.fn(async () => 'reactivated'),
    };
    const useCase = new PlanAccountReactivatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).resolves.toBe(
      'reactivated'
    );
    expect(service.reactivatePlanAccount).toHaveBeenCalledWith(t, 'acc-1');
  });
});
