import 'reflect-metadata';
import { EMethodPayment } from '@core/common/enums/EMethodPayment';
import { MethodPaymentViewerRepository } from '@core/repositories/config/MethodPaymentViewer.repository';

describe('MethodPaymentViewerRepository', () => {
  it('maps method payments list', async () => {
    const dbRo = {
      query: {
        methodPayment: {
          findMany: jest.fn(async () => [
            {
              method_payment_id: 'mp-1',
              type: 'pix',
              status: 'active',
              created_at: '2026-01-01',
              updated_at: '2026-01-02',
            },
          ]),
          findFirst: jest.fn(),
        },
      },
    };
    const repository = new MethodPaymentViewerRepository(dbRo as never);

    await expect(repository.viewMethodPayments()).resolves.toEqual([
      {
        method_payment_id: 'mp-1',
        type: 'pix',
        status: 'active',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);
  });

  it('returns null when payment type is not found', async () => {
    const dbRo = {
      query: {
        methodPayment: {
          findMany: jest.fn(),
          findFirst: jest.fn(async () => null),
        },
      },
    };
    const repository = new MethodPaymentViewerRepository(dbRo as never);

    await expect(
      repository.viewMethodPaymentByType(EMethodPayment.pix)
    ).resolves.toBeNull();
  });
});
