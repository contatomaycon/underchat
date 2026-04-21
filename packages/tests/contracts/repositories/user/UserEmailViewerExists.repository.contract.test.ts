import 'reflect-metadata';
import { UserEmailViewerExistsRepository } from '@core/repositories/user/UserEmailViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('UserEmailViewerExistsRepository', () => {
  it('returns false when count query has no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new UserEmailViewerExistsRepository(db as never);

    await expect(repository.existsUserEmailById('hash-email')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new UserEmailViewerExistsRepository(db as never);

    await expect(repository.existsUserEmailById('hash-email')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new UserEmailViewerExistsRepository(db as never);

    await expect(repository.existsUserEmailById('hash-email')).resolves.toBe(
      true
    );
  });
});
