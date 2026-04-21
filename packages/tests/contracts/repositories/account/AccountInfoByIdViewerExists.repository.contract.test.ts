import 'reflect-metadata';
import { AccountInfoByIdViewerExistsRepository } from '@core/repositories/account/AccountInfoByIdViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AccountInfoByIdViewerExistsRepository', () => {
  it('returns false when there are no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new AccountInfoByIdViewerExistsRepository(db as never);

    await expect(repository.accountInfoByIdExists('info-1')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new AccountInfoByIdViewerExistsRepository(db as never);

    await expect(repository.accountInfoByIdExists('info-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 2 }]);
    const repository = new AccountInfoByIdViewerExistsRepository(db as never);

    await expect(repository.accountInfoByIdExists('info-1')).resolves.toBe(
      true
    );
  });
});
