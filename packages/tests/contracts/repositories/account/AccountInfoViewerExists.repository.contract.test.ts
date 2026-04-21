import 'reflect-metadata';
import { AccountInfoViewerExistsRepository } from '@core/repositories/account/AccountInfoViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AccountInfoViewerExistsRepository', () => {
  it('existsAccountInfoById returns false when there are no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new AccountInfoViewerExistsRepository(db as never);

    await expect(repository.existsAccountInfoById('acc-1')).resolves.toBe(
      false
    );
  });

  it('existsAccountInfoById returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new AccountInfoViewerExistsRepository(db as never);

    await expect(repository.existsAccountInfoById('acc-1')).resolves.toBe(
      false
    );
  });

  it('existsAccountInfoById returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new AccountInfoViewerExistsRepository(db as never);

    await expect(repository.existsAccountInfoById('acc-1')).resolves.toBe(true);
  });

  it('totalAccountInfoByAccountId returns total value when present', async () => {
    const { db } = createSelectDbMock([{ total: 7 }]);
    const repository = new AccountInfoViewerExistsRepository(db as never);

    await expect(repository.totalAccountInfoByAccountId('acc-1')).resolves.toBe(
      7
    );
  });

  it('totalAccountInfoByAccountId returns zero when there are no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new AccountInfoViewerExistsRepository(db as never);

    await expect(repository.totalAccountInfoByAccountId('acc-1')).resolves.toBe(
      0
    );
  });
});
