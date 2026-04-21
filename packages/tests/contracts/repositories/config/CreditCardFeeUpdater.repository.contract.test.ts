import 'reflect-metadata';
import type { TFunction } from 'i18next';
import { randomUUID } from 'node:crypto';
import { CreditCardFeeUpdaterRepository } from '@core/repositories/config/CreditCardFeeUpdater.repository';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

function createInput() {
  return {
    installment_1_rate: 1,
    installment_2_rate: 2,
    installment_3_rate: 3,
    installment_4_rate: 4,
    installment_5_rate: 5,
    installment_6_rate: 6,
    installment_7_rate: 7,
    installment_8_rate: 8,
    installment_9_rate: 9,
    installment_10_rate: 10,
    installment_11_rate: 11,
    installment_12_rate: 12,
  };
}

function createFeeRecord(overrides?: Record<string, unknown>) {
  return {
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
    deleted_at: null,
    ...overrides,
  };
}

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ limit }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('CreditCardFeeUpdaterRepository', () => {
  const t = ((key: string) => key) as unknown as TFunction<
    'translation',
    undefined
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    (randomUUID as unknown as jest.Mock).mockReturnValue('fee-new-id');
  });

  it('updates existing fee record when one already exists', async () => {
    const selectChain = createSelectChain([{ credit_card_fee_id: 'fee-1' }]);
    const updateExecute = jest.fn(async () => ({ rowCount: 1 }));
    const updateWhere = jest.fn(() => ({ execute: updateExecute }));
    const updateSet = jest.fn(() => ({ where: updateWhere }));
    const tx = {
      select: selectChain.select,
      update: jest.fn(() => ({ set: updateSet })),
      insert: jest.fn(),
      query: {
        creditCardFee: {
          findFirst: jest.fn(async () => createFeeRecord()),
        },
      },
    };
    const dbRw = {
      transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
        cb(tx)
      ),
    };
    const repository = new CreditCardFeeUpdaterRepository(dbRw as never);

    await expect(
      repository.upsertCreditCardFee(t, createInput() as never)
    ).resolves.toEqual(
      expect.objectContaining({ credit_card_fee_id: 'fee-1' })
    );
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('creates fee record when none exists', async () => {
    const selectChain = createSelectChain([]);
    const insertExecute = jest.fn(async () => ({ rowCount: 1 }));
    const insertValues = jest.fn(() => ({ execute: insertExecute }));
    const tx = {
      select: selectChain.select,
      update: jest.fn(),
      insert: jest.fn(() => ({ values: insertValues })),
      query: {
        creditCardFee: {
          findFirst: jest.fn(async () =>
            createFeeRecord({ credit_card_fee_id: 'fee-new-id' })
          ),
        },
      },
    };
    const dbRw = {
      transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
        cb(tx)
      ),
    };
    const repository = new CreditCardFeeUpdaterRepository(dbRw as never);

    await expect(
      repository.upsertCreditCardFee(t, createInput() as never)
    ).resolves.toEqual(
      expect.objectContaining({ credit_card_fee_id: 'fee-new-id' })
    );
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });
});
