import 'reflect-metadata';
import { DashboardSectorsRepository } from '@core/repositories/dashboard/DashboardSectors.repository';

function createSectorChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const orderBy = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ orderBy }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('DashboardSectorsRepository', () => {
  it('returns only no-sector aggregate when there are no active sectors', async () => {
    const chain = createSectorChain([]);
    const elasticDatabaseService = {
      select: jest.fn(async () => ({ hits: { total: { value: 4 } } })),
    };
    const repository = new DashboardSectorsRepository(
      {
        select: chain.select,
      } as never,
      elasticDatabaseService as never
    );

    await expect(repository.getSectorsDistribution('acc-1')).resolves.toEqual([
      {
        sectorId: 'no-sector',
        sectorName: 'Sem Setor',
        count: 4,
      },
    ]);
  });
});
