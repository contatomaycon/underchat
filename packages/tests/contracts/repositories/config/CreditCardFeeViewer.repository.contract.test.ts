import 'reflect-metadata';
import { CreditCardFeeViewerRepository } from '@core/repositories/config/CreditCardFeeViewer.repository';

describe('CreditCardFeeViewerRepository', () => {
  it('returns null when no fee record exists', async () => {
    const dbRo = {
      query: {
        creditCardFee: {
          findFirst: jest.fn(async () => null),
        },
      },
    };
    const repository = new CreditCardFeeViewerRepository(dbRo as never);

    await expect(repository.viewCreditCardFee()).resolves.toBeNull();
  });

  it('maps fee record values as numbers', async () => {
    const dbRo = {
      query: {
        creditCardFee: {
          findFirst: jest.fn(async () => ({
            credit_card_fee_id: 'fee-1',
            installment_1_rate: '1',
            installment_2_rate: '2',
            installment_3_rate: '3',
            installment_4_rate: '4',
            installment_5_rate: '5',
            installment_6_rate: '6',
            installment_7_rate: '7',
            installment_8_rate: '8',
            installment_9_rate: '9',
            installment_10_rate: '10',
            installment_11_rate: '11',
            installment_12_rate: '12',
            created_at: '2026-01-01',
            updated_at: '2026-01-02',
          })),
        },
      },
    };
    const repository = new CreditCardFeeViewerRepository(dbRo as never);

    await expect(repository.viewCreditCardFee()).resolves.toEqual(
      expect.objectContaining({
        credit_card_fee_id: 'fee-1',
        installment_1_rate: 1,
        installment_12_rate: 12,
      })
    );
  });
});
