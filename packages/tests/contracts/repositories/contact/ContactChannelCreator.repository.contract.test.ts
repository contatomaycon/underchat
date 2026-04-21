import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { ContactChannelCreatorRepository } from '@core/repositories/contact/ContactChannelCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(() => '2026-04-21T12:00:00.000Z'),
}));

describe('ContactChannelCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('contact-channel-id');
  });

  it('creates contact channel in transaction and returns id', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const insert = jest.fn(() => ({ values }));
    const tx = { insert };

    const repository = new ContactChannelCreatorRepository({} as never);

    await expect(
      repository.createContactChannelInTransaction(
        tx as never,
        'contact-1',
        'channel-1',
        'account-1'
      )
    ).resolves.toBe('contact-channel-id');

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_channel_id: 'contact-channel-id',
        contact_id: 'contact-1',
        channel_id: 'channel-1',
        account_id: 'account-1',
        created_at: '2026-04-21T12:00:00.000Z',
        updated_at: '2026-04-21T12:00:00.000Z',
      })
    );
  });

  it('returns null when insert returns null', async () => {
    const execute = jest.fn(async () => null);
    const values = jest.fn(() => ({ execute }));
    const insert = jest.fn(() => ({ values }));
    const tx = { insert };

    const repository = new ContactChannelCreatorRepository({} as never);

    await expect(
      repository.createContactChannelInTransaction(
        tx as never,
        'contact-1',
        'channel-1',
        'account-1'
      )
    ).resolves.toBeNull();
  });
});
