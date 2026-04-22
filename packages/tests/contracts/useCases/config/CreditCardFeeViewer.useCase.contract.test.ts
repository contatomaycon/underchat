import 'reflect-metadata';

jest.mock('@core/services/creditCardFee.service', () => ({
  CreditCardFeeService: class {},
}));

import { CreditCardFeeViewerUseCase } from '@core/useCases/config/CreditCardFeeViewer.useCase';

describe('CreditCardFeeViewerUseCase', () => {
  it('throws when credit card fee is not found', async () => {
    const creditCardFeeService = {
      viewCreditCardFee: jest.fn(async () => null),
    };
    const useCase = new CreditCardFeeViewerUseCase(
      creditCardFeeService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never)).rejects.toThrow(
      'credit_card_fee_not_found'
    );
  });

  it('returns credit card fee from service', async () => {
    const feeData = { installment_1: 1.99 };
    const creditCardFeeService = {
      viewCreditCardFee: jest.fn(async () => feeData),
    };
    const useCase = new CreditCardFeeViewerUseCase(
      creditCardFeeService as never
    );

    await expect(useCase.execute(jest.fn() as never)).resolves.toEqual(feeData);
  });
});
