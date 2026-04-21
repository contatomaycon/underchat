import 'reflect-metadata';
import { ServerSshListerRepository } from '@core/repositories/server/ServerSshLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ServerSshListerRepository', () => {
  it('returns empty list when no active ssh rows are found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ServerSshListerRepository(db as never);

    await expect(repository.listServerSsh()).resolves.toEqual([]);
  });

  it('returns ssh rows when query has results', async () => {
    const rows = [
      {
        server_id: 'srv-1',
        ssh_ip: '127.0.0.1',
        ssh_port: 22,
        ssh_username: 'root',
        ssh_password: 'pwd',
      },
    ];

    const { db } = createSelectDbMock(rows);
    const repository = new ServerSshListerRepository(db as never);

    await expect(repository.listServerSsh()).resolves.toEqual(rows);
  });
});
