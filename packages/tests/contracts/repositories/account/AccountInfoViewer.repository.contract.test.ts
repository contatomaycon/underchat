import 'reflect-metadata';
import { AccountInfoViewerRepository } from '@core/repositories/account/AccountInfoViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AccountInfoViewerRepository', () => {
  it('viewAccountInfoByAccountId returns first row when found', async () => {
    const { db } = createSelectDbMock([
      {
        account_info_id: 'info-1',
        name: 'Account 1',
        logo: 'logo.png',
      },
    ]);
    const repository = new AccountInfoViewerRepository(db as never);

    await expect(
      repository.viewAccountInfoByAccountId('acc-1')
    ).resolves.toEqual({
      account_info_id: 'info-1',
      name: 'Account 1',
      logo: 'logo.png',
    });
  });

  it('viewAccountInfoByAccountId returns null when no result exists', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new AccountInfoViewerRepository(db as never);

    await expect(
      repository.viewAccountInfoByAccountId('acc-1')
    ).resolves.toBeNull();
  });

  it('viewLogoByAccountInfoId returns logo when found', async () => {
    const { db } = createSelectDbMock([{ logo: 'logo-file.png' }]);
    const repository = new AccountInfoViewerRepository(db as never);

    await expect(repository.viewLogoByAccountInfoId('info-1')).resolves.toBe(
      'logo-file.png'
    );
  });

  it('viewLogoByAccountInfoId returns null when no row is found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new AccountInfoViewerRepository(db as never);

    await expect(
      repository.viewLogoByAccountInfoId('info-1')
    ).resolves.toBeNull();
  });
});
