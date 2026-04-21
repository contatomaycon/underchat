import 'reflect-metadata';
import { AccountViewerExistsRepository } from '@core/repositories/account/AccountViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AccountViewerExistsRepository', () => {
  it('returns false when there are no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new AccountViewerExistsRepository(db as never);

    await expect(repository.existsAccountById('acc-1')).resolves.toBe(false);
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new AccountViewerExistsRepository(db as never);

    await expect(repository.existsAccountById('acc-1')).resolves.toBe(false);
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new AccountViewerExistsRepository(db as never);

    await expect(repository.existsAccountById('acc-1')).resolves.toBe(true);
  });
});
