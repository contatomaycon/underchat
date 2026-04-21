import 'reflect-metadata';
import { ESortBySector } from '@core/common/enums/ESortBySector';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { SectorListerRepository } from '@core/repositories/sector/SectorLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('SectorListerRepository', () => {
  it('setOrders returns default order when sort is empty', () => {
    const repository = new SectorListerRepository({} as never);

    const result = (repository as any).setOrders({});

    expect(result).toHaveLength(2);
  });

  it('setOrders applies sort only for supported key', () => {
    const repository = new SectorListerRepository({} as never);

    const result = (repository as any).setOrders({
      sort_by: [
        { key: ESortBySector.name, order: ESortOrder.asc },
        { key: 'unsupported', order: ESortOrder.desc },
      ],
    });

    expect(result).toHaveLength(1);
  });

  it('setFilters returns empty list when no filters are provided', () => {
    const repository = new SectorListerRepository({} as never);

    const result = (repository as any).setFilters({});

    expect(result).toEqual([]);
  });

  it('setFilters combines text filters and status filter', () => {
    const repository = new SectorListerRepository({} as never);

    const result = (repository as any).setFilters({
      name: 'sales',
      account: 'account',
      color: '#fff',
      sector_status: 'status-1',
    });

    expect(result).toHaveLength(2);
  });

  it('listSector returns empty list when query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new SectorListerRepository(db as never);

    await expect(repository.listSector(10, 1, {}, 'acc-1')).resolves.toEqual(
      []
    );
  });

  it('listSector returns mapped rows and applies pagination', async () => {
    const rows = [
      {
        sector_id: 'sec-1',
        name: 'Sales',
        color: '#fff',
        sector_status: { id: 'active', name: 'Active' },
        account: { id: 'acc-1', name: 'Account 1' },
        created_at: '2026-04-21T10:00:00.000Z',
      },
    ];
    const selectMock = createSelectDbMock(rows);
    const repository = new SectorListerRepository(selectMock.db as never);

    await expect(
      repository.listSector(
        10,
        2,
        {
          sort_by: [{ key: ESortBySector.name, order: ESortOrder.asc }],
        },
        'acc-1'
      )
    ).resolves.toEqual(rows);

    expect(selectMock.orderBy).toHaveBeenCalled();
    expect(selectMock.offset).toHaveBeenCalledWith(10);
  });

  it('listSectorTotal returns count and fallback zero', async () => {
    const withCount = createSelectDbMock([{ count: 5 }]);
    const withoutCount = createSelectDbMock([]);

    const withCountRepository = new SectorListerRepository(
      withCount.db as never
    );
    const withoutCountRepository = new SectorListerRepository(
      withoutCount.db as never
    );

    await expect(
      withCountRepository.listSectorTotal({}, 'acc-1')
    ).resolves.toBe(5);
    await expect(
      withoutCountRepository.listSectorTotal({}, 'acc-1')
    ).resolves.toBe(0);
  });
});
