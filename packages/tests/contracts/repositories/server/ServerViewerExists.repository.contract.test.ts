import 'reflect-metadata';
import { ServerViewerExistsRepository } from '@core/repositories/server/ServerViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ServerViewerExistsRepository', () => {
  it('returns false when count query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ServerViewerExistsRepository(db as never);

    await expect(repository.existsServerById('srv-1')).resolves.toBe(false);
  });

  it('returns false when count is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new ServerViewerExistsRepository(db as never);

    await expect(repository.existsServerById('srv-1')).resolves.toBe(false);
  });

  it('returns true when count is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new ServerViewerExistsRepository(db as never);

    await expect(repository.existsServerById('srv-1')).resolves.toBe(true);
  });
});
