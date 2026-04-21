import 'reflect-metadata';
import { ExpenditureViewerExistsRepository } from '@core/repositories/expenditure/ExpenditureViewerExists.repository';

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ExpenditureViewerExistsRepository', () => {
  it('returns false when query returns empty result', async () => {
    const chain = createChain([]);
    const dbRo = { select: chain.select };
    const repository = new ExpenditureViewerExistsRepository(dbRo as never);

    await expect(repository.existsExpenditureById('exp-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const chain = createChain([{ total: 1 }]);
    const dbRo = { select: chain.select };
    const repository = new ExpenditureViewerExistsRepository(dbRo as never);

    await expect(repository.existsExpenditureById('exp-1')).resolves.toBe(true);
  });
});
