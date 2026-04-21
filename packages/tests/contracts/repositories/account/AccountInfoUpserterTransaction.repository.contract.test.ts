import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { currentTime } from '@core/common/functions/currentTime';
import { AccountInfoUpserterTransactionRepository } from '@core/repositories/account/AccountInfoUpserterTransaction.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

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

describe('AccountInfoUpserterTransactionRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('updates existing account info inside transaction', async () => {
    const set = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => undefined),
      })),
    }));
    const tx = {
      query: {
        accountInfo: {
          findFirst: jest.fn(async () => ({ account_info_id: 'info-1' })),
        },
      },
      update: jest.fn(() => ({
        set,
      })),
      insert: jest.fn(),
    };
    const dbRw = {
      transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
        cb(tx)
      ),
    };
    const repository = new AccountInfoUpserterTransactionRepository(
      dbRw as never
    );
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T15:00:00.000Z');

    await expect(
      repository.upsertAccountInfo('acc-1', buildEditInput() as never, null)
    ).resolves.toEqual({
      accountInfoId: 'info-1',
      created: false,
    });

    expect(set).toHaveBeenCalledWith({
      updated_at: '2026-04-21T15:00:00.000Z',
      logo: null,
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

  it('creates account info when no existing record is found', async () => {
    const values = jest.fn(() => ({
      execute: jest.fn(async () => undefined),
    }));
    const tx = {
      query: {
        accountInfo: {
          findFirst: jest.fn(async () => null),
        },
      },
      update: jest.fn(),
      insert: jest.fn(() => ({
        values,
      })),
    };
    const dbRw = {
      transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
        cb(tx)
      ),
    };
    const repository = new AccountInfoUpserterTransactionRepository(
      dbRw as never
    );
    const uuidMock = uuidv7 as unknown as jest.Mock;
    uuidMock.mockReturnValue('info-created-1');
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T15:30:00.000Z');

    await expect(
      repository.upsertAccountInfo(
        'acc-1',
        {
          ...buildEditInput(),
          light_primary_color: { value: null },
          light_secondary_color: { value: null },
          dark_primary_color: { value: null },
          dark_secondary_color: { value: null },
        } as never,
        'logo.png'
      )
    ).resolves.toEqual({
      accountInfoId: 'info-created-1',
      created: true,
    });

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
      account_id: 'acc-1',
      account_info_id: 'info-created-1',
      created_at: '2026-04-21T15:30:00.000Z',
      updated_at: '2026-04-21T15:30:00.000Z',
    });
  });
});
