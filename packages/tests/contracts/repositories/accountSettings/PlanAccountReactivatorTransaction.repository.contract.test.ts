import 'reflect-metadata';
import type { TFunction } from 'i18next';
import { currentTime } from '@core/common/functions/currentTime';
import { PlanAccountReactivatorTransactionRepository } from '@core/repositories/accountSettings/PlanAccountReactivatorTransaction.repository';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

type UpdateStepMock = {
  execute: jest.Mock<Promise<{ rowCount: number }>, []>;
  where: jest.Mock<
    { execute: jest.Mock<Promise<{ rowCount: number }>, []> },
    []
  >;
  set: jest.Mock<
    {
      where: jest.Mock<
        { execute: jest.Mock<Promise<{ rowCount: number }>, []> },
        []
      >;
    },
    []
  >;
};

function createUpdateStepMock(rowCount: number): UpdateStepMock {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));

  return { execute, where, set };
}

function createRepositoryWithUpdateSteps(rowCounts: number[]) {
  const steps = rowCounts.map((rowCount) => createUpdateStepMock(rowCount));
  const update = jest.fn();

  for (const step of steps) {
    update.mockReturnValueOnce({ set: step.set });
  }

  const tx = { update };
  const transaction = jest.fn(
    async (cb: (txArg: unknown) => Promise<unknown>) => cb(tx)
  );

  return {
    repository: new PlanAccountReactivatorTransactionRepository({
      transaction,
    } as never),
  };
}

function createTranslator(prefix = ''): TFunction<'translation', undefined> {
  return ((key: string) => `${prefix}${key}`) as unknown as TFunction<
    'translation',
    undefined
  >;
}

describe('PlanAccountReactivatorTransactionRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executeReactivation succeeds when both updates affect rows', async () => {
    const { repository } = createRepositoryWithUpdateSteps([1, 1]);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock
      .mockReturnValueOnce('2026-04-21T19:20:00.000Z')
      .mockReturnValueOnce('2026-04-21T19:20:01.000Z');

    await expect(
      repository.executeReactivation(createTranslator(), 'acc-1')
    ).resolves.toBeUndefined();
  });

  it('throws translated error when plan reactivation fails', async () => {
    const { repository } = createRepositoryWithUpdateSteps([0]);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T19:30:00.000Z');

    await expect(
      repository.executeReactivation(createTranslator('tr_'), 'acc-1')
    ).rejects.toThrow('tr_plan_reactivation_error');
  });

  it('throws translated error when account reactivation fails', async () => {
    const { repository } = createRepositoryWithUpdateSteps([1, 0]);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock
      .mockReturnValueOnce('2026-04-21T19:40:00.000Z')
      .mockReturnValueOnce('2026-04-21T19:40:01.000Z');

    await expect(
      repository.executeReactivation(createTranslator('tr_'), 'acc-1')
    ).rejects.toThrow('tr_account_reactivation_error');
  });
});
