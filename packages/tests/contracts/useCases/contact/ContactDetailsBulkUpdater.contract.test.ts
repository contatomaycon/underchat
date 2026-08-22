import 'reflect-metadata';
import { ContactDetailsBulkUpdaterUseCase } from '@core/useCases/contact/ContactDetailsBulkUpdater.useCase';

const accountId = '01900000-0000-7000-8000-000000000001';
const contactId = '01900000-0000-7000-8000-000000000002';
const userId = '01900000-0000-7000-8000-000000000003';
const existingChannelId = '01900000-0000-7000-8000-000000000004';
const requestedChannelId = '01900000-0000-7000-8000-000000000005';
const translate = ((key: string) => key) as never;

describe('ContactDetailsBulkUpdaterUseCase', () => {
  const createUseCase = (
    overrides: {
      getContactById?: jest.Mock;
      listContactChannelsByContactId?: jest.Mock;
      listContactUsers?: jest.Mock;
      execute?: jest.Mock;
    } = {}
  ) => {
    const contactService = {
      getContactById:
        overrides.getContactById ??
        jest.fn(async () => ({
          contact_id: contactId,
          notes: 'Existing note',
        })),
      listContactChannelsByContactId:
        overrides.listContactChannelsByContactId ??
        jest.fn(async () => [existingChannelId]),
      listContactUsers:
        overrides.listContactUsers ??
        jest.fn(async () => [{ user_id: userId, name: 'Ana', photo: null }]),
    };
    const contactUpdaterUseCase = {
      execute: overrides.execute ?? jest.fn(async () => true),
    };

    return {
      useCase: new ContactDetailsBulkUpdaterUseCase(
        contactService as never,
        contactUpdaterUseCase as never
      ),
      contactService,
      contactUpdaterUseCase,
    };
  };

  it('adds only channels not already associated with the contact', async () => {
    const { useCase, contactUpdaterUseCase } = createUseCase();

    await expect(
      useCase.execute({
        accountId,
        allowedChannelIds: [existingChannelId, requestedChannelId],
        request: {
          contact_ids: [contactId],
          operation: 'add_channels',
          channel_ids: [existingChannelId, requestedChannelId],
        },
        t: translate,
        webhookSource: 'manager_api',
      })
    ).resolves.toEqual({
      processed_count: 1,
      changed_count: 1,
      failed_count: 0,
    });

    expect(contactUpdaterUseCase.execute).toHaveBeenCalledWith(
      translate,
      accountId,
      contactId,
      { channel_ids: [existingChannelId, requestedChannelId] },
      [existingChannelId, requestedChannelId],
      undefined,
      'manager_api'
    );
  });

  it('removes only the requested channels and skips an unchanged contact', async () => {
    const { useCase, contactUpdaterUseCase } = createUseCase();

    await expect(
      useCase.execute({
        accountId,
        allowedChannelIds: [existingChannelId, requestedChannelId],
        request: {
          contact_ids: [contactId],
          operation: 'remove_channels',
          channel_ids: [requestedChannelId],
        },
        t: translate,
        webhookSource: 'manager_api',
      })
    ).resolves.toEqual({
      processed_count: 1,
      changed_count: 0,
      failed_count: 0,
    });
    expect(contactUpdaterUseCase.execute).not.toHaveBeenCalled();
  });

  it('removes the selected channel while preserving the remaining channels', async () => {
    const { useCase, contactUpdaterUseCase } = createUseCase({
      listContactChannelsByContactId: jest.fn(async () => [
        existingChannelId,
        requestedChannelId,
      ]),
    });

    await useCase.execute({
      accountId,
      allowedChannelIds: [existingChannelId, requestedChannelId],
      request: {
        contact_ids: [contactId],
        operation: 'remove_channels',
        channel_ids: [requestedChannelId],
      },
      t: translate,
      webhookSource: 'manager_api',
    });

    expect(contactUpdaterUseCase.execute).toHaveBeenCalledWith(
      translate,
      accountId,
      contactId,
      { channel_ids: [existingChannelId] },
      [existingChannelId, requestedChannelId],
      undefined,
      'manager_api'
    );
  });

  it('appends notes without discarding the previous note', async () => {
    const { useCase, contactUpdaterUseCase } = createUseCase();

    await useCase.execute({
      accountId,
      allowedChannelIds: [],
      request: {
        contact_ids: [contactId],
        operation: 'append_notes',
        notes: 'New note',
      },
      t: translate,
      webhookSource: 'manager_api',
    });

    expect(contactUpdaterUseCase.execute).toHaveBeenCalledWith(
      translate,
      accountId,
      contactId,
      { notes: 'Existing note\nNew note' },
      [],
      undefined,
      'manager_api'
    );
  });

  it('clears notes from selected contacts', async () => {
    const { useCase, contactUpdaterUseCase } = createUseCase();

    await expect(
      useCase.execute({
        accountId,
        allowedChannelIds: [],
        request: {
          contact_ids: [contactId],
          operation: 'clear_notes',
        },
        t: translate,
        webhookSource: 'manager_api',
      })
    ).resolves.toEqual({
      processed_count: 1,
      changed_count: 1,
      failed_count: 0,
    });

    expect(contactUpdaterUseCase.execute).toHaveBeenCalledWith(
      translate,
      accountId,
      contactId,
      { notes: '' },
      [],
      undefined,
      'manager_api'
    );
  });

  it('removes the responsible attendant from selected contacts', async () => {
    const { useCase, contactUpdaterUseCase } = createUseCase({
      getContactById: jest.fn(async () => ({
        contact_id: contactId,
        notes: null,
        user: { user_id: userId },
      })),
    });

    await useCase.execute({
      accountId,
      allowedChannelIds: [],
      request: {
        contact_ids: [contactId],
        operation: 'remove_responsible_attendant',
      },
      t: translate,
      webhookSource: 'manager_api',
    });

    expect(contactUpdaterUseCase.execute).toHaveBeenCalledWith(
      translate,
      accountId,
      contactId,
      { user_id: { value: null } },
      [],
      undefined,
      'manager_api'
    );
  });

  it('validates the responsible attendant before updating any contact', async () => {
    const { useCase, contactUpdaterUseCase } = createUseCase({
      listContactUsers: jest.fn(async () => []),
    });

    await expect(
      useCase.execute({
        accountId,
        allowedChannelIds: [],
        request: {
          contact_ids: [contactId],
          operation: 'set_responsible_attendant',
          user_id: userId,
        },
        t: translate,
        webhookSource: 'manager_api',
      })
    ).rejects.toThrow('user_not_found');
    expect(contactUpdaterUseCase.execute).not.toHaveBeenCalled();
  });
});
