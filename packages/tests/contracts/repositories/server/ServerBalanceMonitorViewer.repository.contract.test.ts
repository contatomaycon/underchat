import 'reflect-metadata';
import { ServerBalanceMonitorViewerRepository } from '@core/repositories/server/ServerBalanceMonitorViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ServerBalanceMonitorViewerRepository', () => {
  it('returns empty list when no eligible servers are found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ServerBalanceMonitorViewerRepository(db as never);

    await expect(repository.listEligible()).resolves.toEqual([]);
  });

  it('returns eligible servers from query result', async () => {
    const rows = [
      {
        server_id: 'srv-1',
        server_status_id: 'online',
        ssh_ip: '127.0.0.1',
        ssh_port: 22,
        ssh_username: 'root',
        ssh_password: 'pwd',
        web_domain: 'example.com',
        web_port: 443,
        web_protocol: 'https',
      },
    ];

    const { db } = createSelectDbMock(rows);
    const repository = new ServerBalanceMonitorViewerRepository(db as never);

    await expect(repository.listEligible()).resolves.toEqual(rows);
  });
});
