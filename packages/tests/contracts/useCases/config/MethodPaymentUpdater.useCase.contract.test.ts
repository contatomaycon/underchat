import 'reflect-metadata';

jest.mock('@core/services/methodPayment.service', () => ({
  MethodPaymentService: class {},
}));

import { MethodPaymentUpdaterUseCase } from '@core/useCases/config/MethodPaymentUpdater.useCase';

describe('MethodPaymentUpdaterUseCase', () => {
  it('delegates method payment update to service', async () => {
    const serviceResponse = { success: true };
    const methodPaymentService = {
      updateMethodPayment: jest.fn(async () => serviceResponse),
    };
    const useCase = new MethodPaymentUpdaterUseCase(
      methodPaymentService as never
    );
    const t = jest.fn((key: string) => key);
    const input = { method_payment_id: 'mp-1', active: true } as never;

    await expect(useCase.execute(t as never, input)).resolves.toEqual(
      serviceResponse
    );
    expect(methodPaymentService.updateMethodPayment).toHaveBeenCalledWith(
      t,
      input
    );
  });
});
