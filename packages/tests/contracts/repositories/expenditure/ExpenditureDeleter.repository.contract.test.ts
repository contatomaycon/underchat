import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { ExpenditureDeleterRepository } from '@core/repositories/expenditure/ExpenditureDeleter.repository';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

function createRepository(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const dbRw = {
    update: jest.fn(() => ({ set })),
  };

  return {
    repository: new ExpenditureDeleterRepository(dbRw as never),
    set,
  };
}

describe('ExpenditureDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-01-01T00:00:00.000Z'
    );
  });

  it('sets deleted_at and returns true when one row is affected', async () => {
    const { repository, set } = createRepository(1);

    await expect(repository.deleteExpenditureById('exp-1')).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns false when no rows are affected', async () => {
    const { repository } = createRepository(0);

    await expect(repository.deleteExpenditureById('exp-1')).resolves.toBe(
      false
    );
  });
});
