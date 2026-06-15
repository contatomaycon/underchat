import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { currentTime } from '@core/common/functions/currentTime';
import { EBillingPeriod } from '@core/common/enums/EBillingPeriod';
import { AccountCreatorRepository } from '@core/repositories/account/AccountCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('node:crypto', () => ({
  randomBytes: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('AccountCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('createAccount returns account id when insert succeeds', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new AccountCreatorRepository(db as never);
    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock.mockReturnValue('acc-1');

    await expect(
      repository.createAccount({
        name: 'Account A',
        account_status: { account_status_id: 'status-1' },
        generate_invoice: true,
      } as never)
    ).resolves.toBe('acc-1');

    expect(values).toHaveBeenCalledWith({
      account_id: 'acc-1',
      account_status_id: 'status-1',
      name: 'Account A',
      generate_invoice: true,
    });
  });

  it('createAccount defaults generate_invoice to true when omitted', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new AccountCreatorRepository(db as never);
    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock.mockReturnValue('acc-default');

    await expect(
      repository.createAccount({
        name: 'Account Default',
        account_status: { account_status_id: 'status-1' },
      } as never)
    ).resolves.toBe('acc-default');

    expect(values).toHaveBeenCalledWith({
      account_id: 'acc-default',
      account_status_id: 'status-1',
      name: 'Account Default',
      generate_invoice: true,
    });
  });

  it('createAccount returns null when insert fails', async () => {
    const { db, values } = createInsertDbMock(undefined);
    const repository = new AccountCreatorRepository(db as never);
    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock.mockReturnValue('acc-2');

    await expect(
      repository.createAccount({
        name: 'Account B',
        account_status: { account_status_id: 'status-1' },
        generate_invoice: false,
      } as never)
    ).resolves.toBeNull();

    expect(values).toHaveBeenCalledWith({
      account_id: 'acc-2',
      account_status_id: 'status-1',
      name: 'Account B',
      generate_invoice: false,
    });
  });

  it('createAccountWithPlanAndApiKey creates regular annual plan and api key', async () => {
    const inserts: Array<unknown> = [];
    const tx = {
      query: {
        plan: {
          findFirst: jest.fn(async () => ({
            plan_id: 'plan-1',
            price: '10',
            annual_discount: '25',
            is_test: false,
            days_trial: null,
          })),
        },
      },
      insert: jest.fn(() => ({
        values: jest.fn(async (payload: unknown) => {
          inserts.push(payload);
        }),
      })),
    };
    const dbRw = {
      transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
        cb(tx)
      ),
    };
    const repository = new AccountCreatorRepository(dbRw as never);

    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock
      .mockReturnValueOnce('acc-100')
      .mockReturnValueOnce('plan-account-100')
      .mockReturnValueOnce('api-key-100')
      .mockReturnValueOnce('account-info-100');

    const randomBytesMock = randomBytes as unknown as jest.Mock;
    randomBytesMock.mockReturnValue({
      toString: jest.fn(() => 'generated-key'),
    });

    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T16:00:00.000Z');

    await expect(
      repository.createAccountWithPlanAndApiKey({
        name: 'Account C',
        account_status: { account_status_id: 'status-active' },
        plan: {
          plan_id: 'plan-1',
          billing_period: 'annual',
        },
      } as never)
    ).resolves.toBe('acc-100');

    const planAccountInsert = inserts.find(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'plan_account_id' in (item as Record<string, unknown>)
    ) as Record<string, unknown> | undefined;

    const accountInsert = inserts.find(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'account_status_id' in (item as Record<string, unknown>)
    ) as Record<string, unknown> | undefined;

    expect(accountInsert?.generate_invoice).toBe(true);
    expect(planAccountInsert).toBeDefined();
    expect(planAccountInsert?.billing_period_id).toBe(EBillingPeriod.annual);
    expect(planAccountInsert?.value).toBe('90');

    const apiKeyInsert = inserts.find(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'api_key_id' in (item as Record<string, unknown>)
    ) as Record<string, unknown> | undefined;
    expect(apiKeyInsert?.key).toBe('generated-key');
  });

  it('createAccountWithPlanAndApiKey throws when plan is not found', async () => {
    const tx = {
      query: {
        plan: {
          findFirst: jest.fn(async () => null),
        },
      },
      insert: jest.fn(() => ({
        values: jest.fn(async () => undefined),
      })),
    };
    const dbRw = {
      transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
        cb(tx)
      ),
    };
    const repository = new AccountCreatorRepository(dbRw as never);

    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock
      .mockReturnValueOnce('acc-200')
      .mockReturnValueOnce('plan-account-200');

    await expect(
      repository.createAccountWithPlanAndApiKey({
        name: 'Account D',
        account_status: { account_status_id: 'status-active' },
        generate_invoice: true,
        plan: {
          plan_id: 'missing-plan',
          billing_period: 'monthly',
        },
      } as never)
    ).rejects.toThrow('Plan not found');
  });
});
