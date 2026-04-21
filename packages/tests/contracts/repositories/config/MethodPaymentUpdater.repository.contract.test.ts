import 'reflect-metadata';
import type { TFunction } from 'i18next';
import { MethodPaymentUpdaterRepository } from '@core/repositories/config/MethodPaymentUpdater.repository';

describe('MethodPaymentUpdaterRepository', () => {
  const t = ((key: string) => key) as unknown as TFunction<
    'translation',
    undefined
  >;

  it('throws translated error when no record is updated', async () => {
    const returning = jest.fn(async () => []);
    const where = jest.fn(() => ({ returning }));
    const set = jest.fn(() => ({ where }));
    const dbRw = {
      update: jest.fn(() => ({ set })),
    };
    const repository = new MethodPaymentUpdaterRepository(dbRw as never);

    await expect(
      repository.updateMethodPayment(t, {
        method_payment_id: 'mp-1',
        status: 'active',
      } as never)
    ).rejects.toThrow('method_payment_not_found');
  });

  it('returns mapped updated method payment', async () => {
    const returning = jest.fn(async () => [
      {
        method_payment_id: 'mp-1',
        type: 'pix',
        status: 'active',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);
    const where = jest.fn(() => ({ returning }));
    const set = jest.fn(() => ({ where }));
    const dbRw = {
      update: jest.fn(() => ({ set })),
    };
    const repository = new MethodPaymentUpdaterRepository(dbRw as never);

    await expect(
      repository.updateMethodPayment(t, {
        method_payment_id: 'mp-1',
        status: 'active',
      } as never)
    ).resolves.toEqual({
      method_payment_id: 'mp-1',
      type: 'pix',
      status: 'active',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
  });
});
