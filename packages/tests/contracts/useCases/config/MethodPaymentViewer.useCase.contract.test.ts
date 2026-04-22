import 'reflect-metadata';

jest.mock('@core/services/methodPayment.service', () => ({
  MethodPaymentService: class {},
}));

import { MethodPaymentViewerUseCase } from '@core/useCases/config/MethodPaymentViewer.useCase';

describe('MethodPaymentViewerUseCase', () => {
  it('returns method payments from service', async () => {
    const methodPayments = [{ method_payment_id: 'mp-1' }];
    const methodPaymentService = {
      viewMethodPayments: jest.fn(async () => methodPayments),
    };
    const useCase = new MethodPaymentViewerUseCase(
      methodPaymentService as never
    );

    await expect(useCase.execute()).resolves.toEqual(methodPayments);
  });
});
