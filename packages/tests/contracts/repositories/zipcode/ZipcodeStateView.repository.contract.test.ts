import 'reflect-metadata';
import { ZipcodeStateViewRepository } from '@core/repositories/zipcode/ZipcodeStateView.repository';

function createStateSelectQuery(result: unknown[]) {
  const executeWithWhere = jest.fn(async () => result);
  const orderByWithWhere = jest.fn(() => ({ execute: executeWithWhere }));
  const where = jest.fn(() => ({ orderBy: orderByWithWhere }));

  const executeWithoutWhere = jest.fn(async () => result);
  const orderByWithoutWhere = jest.fn(() => ({ execute: executeWithoutWhere }));

  const from = jest.fn(() => ({ where, orderBy: orderByWithoutWhere }));
  const select = jest.fn(() => ({ from }));

  return {
    select,
    where,
    orderByWithWhere,
    orderByWithoutWhere,
  };
}

describe('ZipcodeStateViewRepository', () => {
  it('filters by country_id when provided', async () => {
    const rows = [
      {
        id_zipcode_state: 1,
        state: 'São Paulo',
        abbreviation: 'SP',
        fiscal_code: '35',
      },
    ];
    const mock = createStateSelectQuery(rows);
    const repository = new ZipcodeStateViewRepository({
      select: mock.select,
    } as never);

    await expect(
      repository.listStates({ country_id: 1 } as never)
    ).resolves.toEqual(rows);

    expect(mock.where).toHaveBeenCalled();
    expect(mock.orderByWithWhere).toHaveBeenCalled();
  });

  it('lists all states when country_id is not provided', async () => {
    const rows = [
      {
        id_zipcode_state: 2,
        state: 'Rio de Janeiro',
        abbreviation: 'RJ',
        fiscal_code: '33',
      },
    ];
    const mock = createStateSelectQuery(rows);
    const repository = new ZipcodeStateViewRepository({
      select: mock.select,
    } as never);

    await expect(repository.listStates({} as never)).resolves.toEqual(rows);

    expect(mock.where).not.toHaveBeenCalled();
    expect(mock.orderByWithoutWhere).toHaveBeenCalled();
  });
});
