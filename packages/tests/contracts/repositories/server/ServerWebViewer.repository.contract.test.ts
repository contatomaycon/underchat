import 'reflect-metadata';
import { ServerWebViewerRepository } from '@core/repositories/server/ServerWebViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ServerWebViewerRepository', () => {
  it('returns null when web data is not found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ServerWebViewerRepository(db as never);

    await expect(repository.viewServerWebById('srv-1')).resolves.toBeNull();
  });

  it('returns web data when query has one row', async () => {
    const row = {
      server_id: 'srv-1',
      server_status_id: 'online',
      web_domain: 'example.com',
      web_port: 443,
      web_protocol: 'https',
    };

    const { db } = createSelectDbMock([row]);
    const repository = new ServerWebViewerRepository(db as never);

    await expect(repository.viewServerWebById('srv-1')).resolves.toEqual(row);
  });
});
