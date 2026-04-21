import 'reflect-metadata';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ScheduleContactsListerRepository } from '@core/repositories/schedule/ScheduleContactsLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ScheduleContactsListerRepository', () => {
  it('setOrders returns default order when sort is empty', () => {
    const repository = new ScheduleContactsListerRepository({} as never);

    const result = (repository as any).setOrders({});

    expect(result).toHaveLength(2);
  });

  it('setOrders applies only supported sort key', () => {
    const repository = new ScheduleContactsListerRepository({} as never);

    const result = (repository as any).setOrders({
      sort_by: [
        { key: 'name', order: ESortOrder.asc },
        { key: 'unknown', order: ESortOrder.desc },
      ],
    });

    expect(result).toHaveLength(1);
  });

  it('setFilters returns base filters when search is empty', () => {
    const repository = new ScheduleContactsListerRepository({} as never);

    const result = (repository as any).setFilters({}, 'acc-1', null, null);

    expect(result).toHaveLength(2);
  });

  it('setFilters appends combined search conditions', () => {
    const repository = new ScheduleContactsListerRepository({} as never);

    const result = (repository as any).setFilters(
      {
        search: 'john doe',
      },
      'acc-1',
      'hash-1',
      ['hash-2']
    );

    expect(result.length).toBeGreaterThan(2);
  });

  it('listScheduleContacts returns empty list when query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ScheduleContactsListerRepository(db as never);

    await expect(
      repository.listScheduleContacts(10, 1, {}, 'acc-1', null, null)
    ).resolves.toEqual([]);
  });

  it('listScheduleContacts maps nullable fields and pagination', async () => {
    const rows = [
      {
        contact_id: 'ct-1',
        name: 'John',
        last_name: null,
        phone_partial: null,
      },
    ];
    const selectMock = createSelectDbMock(rows);
    const repository = new ScheduleContactsListerRepository(
      selectMock.db as never
    );

    await expect(
      repository.listScheduleContacts(
        10,
        2,
        {
          sort_by: [{ key: 'name', order: ESortOrder.asc }],
        },
        'acc-1',
        null,
        null
      )
    ).resolves.toEqual(rows);

    expect(selectMock.offset).toHaveBeenCalledWith(10);
  });

  it('listScheduleContactsTotal returns count and zero fallback', async () => {
    const withCount = createSelectDbMock([{ count: 12 }]);
    const withoutCount = createSelectDbMock([]);

    const withCountRepository = new ScheduleContactsListerRepository(
      withCount.db as never
    );
    const withoutCountRepository = new ScheduleContactsListerRepository(
      withoutCount.db as never
    );

    await expect(
      withCountRepository.listScheduleContactsTotal({}, 'acc-1', null, null)
    ).resolves.toBe(12);

    await expect(
      withoutCountRepository.listScheduleContactsTotal({}, 'acc-1', null, null)
    ).resolves.toBe(0);
  });
});
