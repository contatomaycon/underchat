import 'reflect-metadata';
import { ServerSshViewerNotIdByIpExistsRepository } from '@core/repositories/server/ServerSshViewerNotIdByIpExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ServerSshViewerNotIdByIpExistsRepository', () => {
  it('returns false when count query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ServerSshViewerNotIdByIpExistsRepository(
      db as never
    );

    await expect(
      repository.existsServerNotIdAndByIp('srv-1', '127.0.0.1')
    ).resolves.toBe(false);
  });

  it('returns false when count is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new ServerSshViewerNotIdByIpExistsRepository(
      db as never
    );

    await expect(
      repository.existsServerNotIdAndByIp('srv-1', '127.0.0.1')
    ).resolves.toBe(false);
  });

  it('returns true when count is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new ServerSshViewerNotIdByIpExistsRepository(
      db as never
    );

    await expect(
      repository.existsServerNotIdAndByIp('srv-1', '127.0.0.1')
    ).resolves.toBe(true);
  });
});
