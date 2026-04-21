import 'reflect-metadata';
import { DashboardChannelsStatusRepository } from '@core/repositories/dashboard/DashboardChannelsStatus.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('DashboardChannelsStatusRepository', () => {
  it('returns mapped channels status data', async () => {
    const { db, execute, from, innerJoin, where, orderBy } = createSelectDbMock(
      [
        {
          id: 'worker-1',
          name: 'Support',
          status: {
            id: 'status-1',
            name: 'Online',
          },
        },
        {
          id: 'worker-2',
          name: 'Sales',
          status: null,
        },
      ]
    );

    const repository = new DashboardChannelsStatusRepository(db as never);

    await expect(repository.listChannelsStatus('account-1')).resolves.toEqual([
      {
        id: 'worker-1',
        name: 'Support',
        status: {
          id: 'status-1',
          name: 'Online',
        },
      },
      {
        id: 'worker-2',
        name: 'Sales',
        status: null,
      },
    ]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(innerJoin).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when the query returns no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new DashboardChannelsStatusRepository(db as never);

    await expect(repository.listChannelsStatus('account-1')).resolves.toEqual(
      []
    );
  });
});
