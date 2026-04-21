import 'reflect-metadata';
import { ExpenditureUpdaterRepository } from '@core/repositories/expenditure/ExpenditureUpdater.repository';

function createRepository(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const dbRw = {
    update: jest.fn(() => ({ set })),
  };

  return {
    repository: new ExpenditureUpdaterRepository(dbRw as never),
    set,
  };
}

describe('ExpenditureUpdaterRepository', () => {
  it('updates mapped fields and converts price to string', async () => {
    const { repository, set } = createRepository(1);

    await expect(
      repository.updateExpenditureById(
        {
          name: 'Updated',
          description: 'New',
          price: 50,
        } as never,
        'exp-1'
      )
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      name: 'Updated',
      description: 'New',
      price: '50',
    });
  });

  it('returns false when update affects zero rows', async () => {
    const { repository } = createRepository(0);

    await expect(
      repository.updateExpenditureById({ name: 'x' } as never, 'exp-1')
    ).resolves.toBe(false);
  });
});
