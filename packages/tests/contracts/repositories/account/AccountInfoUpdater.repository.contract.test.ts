import 'reflect-metadata';
import { AccountInfoUpdaterRepository } from '@core/repositories/account/AccountInfoUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

function buildEditInput() {
  return {
    account_id: { value: 'acc-1' },
    content_width: { value: 'fluid' },
    content_layout_nav: { value: 'vertical' },
    default_locale: { value: 'pt' },
    skin: { value: 'default' },
    navbar: { value: 'sticky' },
    footer: { value: 'sticky' },
    is_vertical_nav_collapsed: { value: false },
    is_vertical_nav_semi_dark: { value: true },
    light_primary_color: { value: '#111111' },
    light_secondary_color: { value: '#222222' },
    dark_primary_color: { value: '#333333' },
    dark_secondary_color: { value: '#444444' },
  };
}

describe('AccountInfoUpdaterRepository', () => {
  it('updates account info and returns true when one row is affected', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new AccountInfoUpdaterRepository(db as never);

    await expect(
      repository.updateAccountInfoById(
        'info-1',
        buildEditInput() as never,
        'logo.png'
      )
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      logo: 'logo.png',
      content_width: 'fluid',
      content_layout_nav: 'vertical',
      default_locale: 'pt',
      skin: 'default',
      navbar: 'sticky',
      footer: 'sticky',
      is_vertical_nav_collapsed: false,
      is_vertical_nav_semi_dark: true,
      light_primary_color: '#111111',
      light_secondary_color: '#222222',
      dark_primary_color: '#333333',
      dark_secondary_color: '#444444',
    });
  });

  it('does not set logo when urlLogo is undefined and skips nullable fields', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new AccountInfoUpdaterRepository(db as never);

    await expect(
      repository.updateAccountInfoById(
        'info-2',
        {
          ...buildEditInput(),
          content_width: { value: null },
          content_layout_nav: { value: null },
          default_locale: { value: null },
          skin: { value: null },
          navbar: { value: null },
          footer: { value: null },
          light_primary_color: { value: null },
          light_secondary_color: { value: null },
          dark_primary_color: { value: null },
          dark_secondary_color: { value: null },
          is_vertical_nav_collapsed: { value: false },
          is_vertical_nav_semi_dark: { value: false },
        } as never,
        undefined
      )
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      is_vertical_nav_collapsed: false,
      is_vertical_nav_semi_dark: false,
    });
  });

  it('returns false when no rows are affected', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new AccountInfoUpdaterRepository(db as never);

    await expect(
      repository.updateAccountInfoById(
        'info-3',
        buildEditInput() as never,
        null
      )
    ).resolves.toBe(false);
  });
});
