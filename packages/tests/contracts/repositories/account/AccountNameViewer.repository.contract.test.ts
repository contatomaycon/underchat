import 'reflect-metadata';
import { AccountNameViewerRepository } from '@core/repositories/account/AccountNameViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AccountNameViewerRepository', () => {
  it('returns first account when found', async () => {
    const { db } = createSelectDbMock([{ id: 'acc-1', name: 'My Account' }]);
    const repository = new AccountNameViewerRepository(
      db as never,
      db as never
    );

    await expect(repository.viewAccountName('acc-1')).resolves.toEqual({
      id: 'acc-1',
      name: 'My Account',
    });
  });

  it('returns null when no account is found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new AccountNameViewerRepository(
      db as never,
      db as never
    );

    await expect(repository.viewAccountName('acc-1')).resolves.toBeNull();
  });

  it('uses the primary database for the consistent lookup', async () => {
    const replica = createSelectDbMock([]);
    const primary = createSelectDbMock([
      { id: 'acc-1', name: 'Primary Account' },
    ]);
    const repository = new AccountNameViewerRepository(
      replica.db as never,
      primary.db as never
    );

    await expect(repository.viewAccountName('acc-1')).resolves.toBeNull();
    await expect(
      repository.viewAccountNameConsistent('acc-1')
    ).resolves.toEqual({
      id: 'acc-1',
      name: 'Primary Account',
    });
  });
});
