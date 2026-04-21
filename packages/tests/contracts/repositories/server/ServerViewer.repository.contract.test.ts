import 'reflect-metadata';
import { ServerViewerRepository } from '@core/repositories/server/ServerViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ServerViewerRepository', () => {
  it('returns null when server does not exist or is deleted', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ServerViewerRepository(db as never);

    await expect(repository.viewServerById('srv-1')).resolves.toBeNull();
  });

  it('returns server data when query has one row', async () => {
    const row = {
      name: 'Server 1',
      quantity_workers: 2,
      status: { id: 'online', name: 'Online' },
      ssh: { ssh_ip: '127.0.0.1', ssh_port: 22 },
      web: { web_domain: 'example.com', web_port: 443, web_protocol: 'https' },
      proxy: {
        enabled: false,
        protocol: 'http',
        host: null,
        port: null,
      },
      created_at: '2026-04-21T10:00:00.000Z',
      updated_at: '2026-04-21T11:00:00.000Z',
    };

    const { db } = createSelectDbMock([row]);
    const repository = new ServerViewerRepository(db as never);

    await expect(repository.viewServerById('srv-1')).resolves.toEqual(row);
  });
});
