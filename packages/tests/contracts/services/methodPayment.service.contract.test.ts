import 'reflect-metadata';
import { MethodPaymentService } from '@core/services/methodPayment.service';

describe('MethodPaymentService', () => {
  it('delegates view methods and update', async () => {
    const viewMethodPayments = jest.fn(async () => [{ type: 'pix' }]);
    const viewMethodPaymentByType = jest.fn(async () => ({ type: 'pix' }));
    const updateMethodPayment = jest.fn(async () => ({ ok: true }));

    const service = new MethodPaymentService(
      { viewMethodPayments, viewMethodPaymentByType } as never,
      { updateMethodPayment } as never
    );

    await expect(service.viewMethodPayments()).resolves.toEqual([
      { type: 'pix' },
    ]);
    await expect(service.viewMethodPaymentByType('pix')).resolves.toEqual({
      type: 'pix',
    });
    await expect(
      service.updateMethodPayment(
        ((k: string) => k) as never,
        { enabled: true } as never
      )
    ).resolves.toEqual({ ok: true });
  });
});
