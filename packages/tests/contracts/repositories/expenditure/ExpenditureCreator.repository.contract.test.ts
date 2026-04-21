import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { ExpenditureCreatorRepository } from '@core/repositories/expenditure/ExpenditureCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createRepository(insertResult: unknown = { rowCount: 1 }) {
  const execute = jest.fn(async () => insertResult);
  const values = jest.fn(() => ({ execute }));
  const dbRw = {
    insert: jest.fn(() => ({ values })),
  };

  return {
    repository: new ExpenditureCreatorRepository(dbRw as never),
    values,
  };
}

describe('ExpenditureCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('exp-1');
  });

  it('creates expenditure and returns id', async () => {
    const { repository, values } = createRepository();

    await expect(
      repository.createExpenditure({
        name: 'Infra',
        description: 'Cloud',
        price: 120.5,
      } as never)
    ).resolves.toBe('exp-1');
    expect(values).toHaveBeenCalledWith({
      expenditure_id: 'exp-1',
      name: 'Infra',
      description: 'Cloud',
      price: '120.5',
    });
  });

  it('returns null when insert result is empty', async () => {
    const { repository } = createRepository(null);

    await expect(
      repository.createExpenditure({
        name: 'Infra',
        description: 'Cloud',
        price: 120.5,
      } as never)
    ).resolves.toBeNull();
  });
});
