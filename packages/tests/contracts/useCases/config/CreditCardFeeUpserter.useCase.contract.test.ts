import 'reflect-metadata';

jest.mock('@core/services/creditCardFee.service', () => ({
  CreditCardFeeService: class {},
}));

import { CreditCardFeeUpserterUseCase } from '@core/useCases/config/CreditCardFeeUpserter.useCase';

describe('CreditCardFeeUpserterUseCase', () => {
  it('delegates credit card fee upsert to service', async () => {
    const serviceResponse = { success: true };
    const creditCardFeeService = {
      upsertCreditCardFee: jest.fn(async () => serviceResponse),
    };
    const useCase = new CreditCardFeeUpserterUseCase(
      creditCardFeeService as never
    );
    const t = jest.fn((key: string) => key);
    const input = { installment_1: 1.99 } as never;

    await expect(useCase.execute(t as never, input)).resolves.toEqual(
      serviceResponse
    );
    expect(creditCardFeeService.upsertCreditCardFee).toHaveBeenCalledWith(
      t,
      input
    );
  });
});
