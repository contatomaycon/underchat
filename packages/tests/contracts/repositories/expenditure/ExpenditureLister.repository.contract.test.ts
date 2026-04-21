import 'reflect-metadata';
import { ExpenditureListerRepository } from '@core/repositories/expenditure/ExpenditureLister.repository';

function createCountChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ExpenditureListerRepository', () => {
  it('maps listExpenditures result and converts price to number', async () => {
    const dbRo = {
      query: {
        expenditure: {
          findMany: jest.fn(async () => [
            {
              expenditure_id: 'exp-1',
              name: 'Infra',
              description: 'Cloud',
              price: '123.4',
              created_at: '2026-01-01',
            },
          ]),
        },
      },
      select: jest.fn(),
    };
    const repository = new ExpenditureListerRepository(dbRo as never);

    await expect(
      repository.listExpenditures(10, 1, {} as never)
    ).resolves.toEqual([
      {
        expenditure_id: 'exp-1',
        name: 'Infra',
        description: 'Cloud',
        price: 123.4,
        created_at: '2026-01-01',
      },
    ]);
  });

  it('returns empty list when query returns null', async () => {
    const dbRo = {
      query: {
        expenditure: {
          findMany: jest.fn(async () => null),
        },
      },
      select: jest.fn(),
    };
    const repository = new ExpenditureListerRepository(dbRo as never);

    await expect(
      repository.listExpenditures(10, 1, {} as never)
    ).resolves.toEqual([]);
  });

  it('returns total count fallback', async () => {
    const chain = createCountChain([{ count: 4 }]);
    const dbRo = {
      query: {
        expenditure: {
          findMany: jest.fn(),
        },
      },
      select: chain.select,
    };
    const repository = new ExpenditureListerRepository(dbRo as never);

    await expect(repository.listExpendituresTotal({} as never)).resolves.toBe(
      4
    );
  });
});
