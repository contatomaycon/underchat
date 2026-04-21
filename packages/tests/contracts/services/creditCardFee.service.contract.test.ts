import 'reflect-metadata';
import { CreditCardFeeService } from '@core/services/creditCardFee.service';

describe('CreditCardFeeService', () => {
  it('delegates view and upsert to repositories', async () => {
    const viewCreditCardFee = jest.fn(async () => ({ fee: '3.99' }));
    const upsertCreditCardFee = jest.fn(async () => ({ fee: '4.99' }));
    const service = new CreditCardFeeService(
      { viewCreditCardFee } as never,
      { upsertCreditCardFee } as never
    );

    await expect(service.viewCreditCardFee()).resolves.toEqual({ fee: '3.99' });
    await expect(
      service.upsertCreditCardFee(((k: string) => k) as never, {} as never)
    ).resolves.toEqual({ fee: '4.99' });
  });
});
