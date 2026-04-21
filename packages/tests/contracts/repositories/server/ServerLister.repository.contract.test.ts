import 'reflect-metadata';
import { ESortByServer } from '@core/common/enums/ESortByServer';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ServerListerRepository } from '@core/repositories/server/ServerLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ServerListerRepository', () => {
  it('setOrders returns default order when sort is empty', () => {
    const repository = new ServerListerRepository({} as never);

    const result = (repository as any).setOrders({});

    expect(result).toHaveLength(2);
  });

  it('setOrders maps known fields and ignores unknown fields', () => {
    const repository = new ServerListerRepository({} as never);

    const result = (repository as any).setOrders({
      sort_by: [
        { key: ESortByServer.name, order: ESortOrder.asc },
        { key: 'unknown', order: ESortOrder.desc },
      ],
    });

    expect(result).toHaveLength(1);
  });

  it('setFilters returns empty array when no filters are provided', () => {
    const repository = new ServerListerRepository({} as never);

    const result = (repository as any).setFilters({});

    expect(result).toEqual([]);
  });

  it('setFilters combines search and status filters', () => {
    const repository = new ServerListerRepository({} as never);

    const result = (repository as any).setFilters({
      server_name: 'app',
      ssh_ip: '10.0.0.',
      web_domain: 'example.com',
      server_status_id: 'online',
    });

    expect(result).toHaveLength(2);
  });

  it('listServers returns empty list when query has no rows', async () => {
    const selectMock = createSelectDbMock([]);
    const repository = new ServerListerRepository(selectMock.db as never);

    await expect(repository.listServers(10, 1, {} as never)).resolves.toEqual(
      []
    );
  });

  it('listServers returns rows from query', async () => {
    const rows = [
      {
        id: 'srv-1',
        name: 'Server 1',
        quantity_workers: 2,
        status: { id: 'online', name: 'Online' },
        ssh: { ssh_ip: '127.0.0.1', ssh_port: 22 },
        web: {
          web_domain: 'example.com',
          web_port: 443,
          web_protocol: 'https',
        },
        last_sync: null,
        created_at: '2026-04-21T10:00:00.000Z',
        updated_at: '2026-04-21T10:00:00.000Z',
      },
    ];

    const selectMock = createSelectDbMock(rows);
    const repository = new ServerListerRepository(selectMock.db as never);

    await expect(
      repository.listServers(10, 2, {
        sort_by: [{ key: ESortByServer.name, order: ESortOrder.asc }],
      } as never)
    ).resolves.toEqual(rows);

    expect(selectMock.orderBy).toHaveBeenCalled();
    expect(selectMock.offset).toHaveBeenCalledWith(10);
  });

  it('listServersTotal returns count from query', async () => {
    const selectMock = createSelectDbMock([{ count: 3 }]);
    const repository = new ServerListerRepository(selectMock.db as never);

    await expect(repository.listServersTotal({} as never)).resolves.toBe(3);
  });

  it('listServersTotal returns zero when count is missing', async () => {
    const selectMock = createSelectDbMock([]);
    const repository = new ServerListerRepository(selectMock.db as never);

    await expect(repository.listServersTotal({} as never)).resolves.toBe(0);
  });
});
