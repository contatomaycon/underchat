import 'reflect-metadata';
import { UserStatusViewerExistsRepository } from '@core/repositories/user/UserStatusViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('UserStatusViewerExistsRepository', () => {
  it('returns false when count query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new UserStatusViewerExistsRepository(db as never);

    await expect(repository.existsUserStatusById('status-1')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new UserStatusViewerExistsRepository(db as never);

    await expect(repository.existsUserStatusById('status-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 2 }]);
    const repository = new UserStatusViewerExistsRepository(db as never);

    await expect(repository.existsUserStatusById('status-1')).resolves.toBe(
      true
    );
  });
});
