import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { currentTime } from '@core/common/functions/currentTime';
import { AccountInfoCreatorRepository } from '@core/repositories/account/AccountInfoCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

function buildCreateInput() {
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

describe('AccountInfoCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates account info and returns generated id', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new AccountInfoCreatorRepository(db as never);

    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock.mockReturnValue('account-info-id-1');

    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T12:00:00.000Z');

    await expect(
      repository.createAccountInfo(buildCreateInput() as never, 'logo.png')
    ).resolves.toBe('account-info-id-1');

    expect(values).toHaveBeenCalledWith({
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
      account_id: 'acc-1',
      account_info_id: 'account-info-id-1',
      created_at: '2026-04-21T12:00:00.000Z',
      updated_at: '2026-04-21T12:00:00.000Z',
    });
  });

  it('skips nullable fields and still persists boolean values', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new AccountInfoCreatorRepository(db as never);

    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock.mockReturnValue('account-info-id-2');

    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T12:30:00.000Z');

    await expect(
      repository.createAccountInfo(
        {
          ...buildCreateInput(),
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
        null
      )
    ).resolves.toBe('account-info-id-2');

    expect(values).toHaveBeenCalledWith({
      is_vertical_nav_collapsed: false,
      is_vertical_nav_semi_dark: false,
      account_id: 'acc-1',
      account_info_id: 'account-info-id-2',
      created_at: '2026-04-21T12:30:00.000Z',
      updated_at: '2026-04-21T12:30:00.000Z',
    });
  });

  it('returns null when insert fails', async () => {
    const { db } = createInsertDbMock(undefined);
    const repository = new AccountInfoCreatorRepository(db as never);

    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock.mockReturnValue('account-info-id-3');

    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T13:00:00.000Z');

    await expect(
      repository.createAccountInfo(buildCreateInput() as never, 'logo.png')
    ).resolves.toBeNull();
  });
});
