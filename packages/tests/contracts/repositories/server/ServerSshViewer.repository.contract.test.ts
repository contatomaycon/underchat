import 'reflect-metadata';
import { ServerSshViewerRepository } from '@core/repositories/server/ServerSshViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ServerSshViewerRepository', () => {
  it('returns null when server ssh data is not found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ServerSshViewerRepository(db as never);

    await expect(repository.viewServerSshById('srv-1')).resolves.toBeNull();
  });

  it('returns ssh data for an existing server', async () => {
    const row = {
      server_status_id: 'online',
      ssh_ip: '127.0.0.1',
      ssh_port: 22,
      ssh_username: 'root',
      ssh_password: 'pwd',
      proxy_enabled: false,
      proxy_protocol: 'http',
      proxy_host: null,
      proxy_port: null,
      proxy_username: null,
      proxy_password: null,
    };

    const { db } = createSelectDbMock([row]);
    const repository = new ServerSshViewerRepository(db as never);

    await expect(repository.viewServerSshById('srv-1')).resolves.toEqual(row);
  });
});
