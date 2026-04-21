import 'reflect-metadata';
import { ServerSshViewerExistsRepository } from '@core/repositories/server/ServerSshViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ServerSshViewerExistsRepository', () => {
  it('returns false when count query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ServerSshViewerExistsRepository(db as never);

    await expect(repository.existsServerByIp('127.0.0.1')).resolves.toBe(false);
  });

  it('returns false when count is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new ServerSshViewerExistsRepository(db as never);

    await expect(repository.existsServerByIp('127.0.0.1')).resolves.toBe(false);
  });

  it('returns true when count is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 2 }]);
    const repository = new ServerSshViewerExistsRepository(db as never);

    await expect(repository.existsServerByIp('127.0.0.1')).resolves.toBe(true);
  });
});
