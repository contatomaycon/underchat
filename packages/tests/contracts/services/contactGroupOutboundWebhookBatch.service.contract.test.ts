import 'reflect-metadata';

const lockSnapshot = jest.fn();
const viewSnapshot = jest.fn();
const markApplied = jest.fn();

jest.mock('@core/repositories/contact/contactOutboundWebhookOutbox', () => ({
  lockContactOutboundWebhookSnapshotInTransaction: (...args: unknown[]) =>
    lockSnapshot(...args),
  viewContactOutboundWebhookSnapshotWithExecutor: (...args: unknown[]) =>
    viewSnapshot(...args),
  markContactOutboundWebhookAppliedInTransaction: (...args: unknown[]) =>
    markApplied(...args),
}));

import { ContactGroupOutboundWebhookBatchService } from '@core/services/contactGroupOutboundWebhookBatch.service';

describe('ContactGroupOutboundWebhookBatchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lockSnapshot.mockResolvedValue(undefined);
    markApplied.mockResolvedValue(undefined);
  });

  it('locks contacts deterministically and prepares their intended public snapshots', async () => {
    viewSnapshot.mockImplementation(
      async (_tx: unknown, contactId: string) => ({
        contact_id: contactId,
        name: `Contact ${contactId}`,
        channel_ids: ['01900000-0000-7000-8000-000000000099'],
        contact_groups:
          contactId === 'c-1'
            ? [
                { contact_group_id: 'cg-1', name: 'Old group name' },
                { contact_group_id: 'cg-other', name: 'Other' },
              ]
            : [],
      })
    );
    const prepareBestEffort = jest
      .fn()
      .mockResolvedValueOnce({
        eventId: 'event-1',
        state: 'preparing',
        envelope: { id: 'event-1' },
      })
      .mockResolvedValueOnce({
        eventId: 'event-2',
        state: 'ready',
        envelope: { id: 'event-2' },
      });
    const service = new ContactGroupOutboundWebhookBatchService({
      prepareBestEffort,
    } as never);
    const tx = { id: 'tx-1' } as never;

    const batch = await service.prepareInTransaction({
      tx,
      accountId: 'account-1',
      actorUserId: 'user-1',
      operationId: 'operation-1',
      operation: 'updated',
      contactGroupId: 'cg-1',
      contactGroupName: 'New group name',
      affectedContactIds: ['c-2', 'c-1', 'c-2'],
      nextMemberIds: new Set(['c-2']),
    });

    expect(lockSnapshot.mock.calls.map((call) => call[1])).toEqual([
      'c-1',
      'c-2',
    ]);
    expect(viewSnapshot.mock.calls.map((call) => call[1])).toEqual([
      'c-1',
      'c-2',
    ]);
    expect(prepareBestEffort).toHaveBeenCalledTimes(2);
    expect(prepareBestEffort.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        accountId: 'account-1',
        eventType: 'contact.updated',
        aggregate: { type: 'contact', id: 'c-1' },
        source: 'manager_api',
        actor: { type: 'user', id: 'user-1' },
        data: expect.objectContaining({
          contact: expect.objectContaining({
            contact_groups: [{ contact_group_id: 'cg-other', name: 'Other' }],
          }),
          changes: {
            contact_group_id: 'cg-1',
            contact_group_operation: 'updated',
          },
        }),
      })
    );
    expect(prepareBestEffort.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        aggregate: { type: 'contact', id: 'c-2' },
        data: expect.objectContaining({
          contact: expect.objectContaining({
            contact_groups: [
              { contact_group_id: 'cg-1', name: 'New group name' },
            ],
          }),
        }),
      })
    );
    expect(batch.entries).toHaveLength(2);
    expect(batch.entries[0].marker).toEqual({
      eventId: 'event-1',
      accountId: 'account-1',
      envelope: { id: 'event-1' },
    });
    expect(batch.entries[1].marker).toBeNull();
  });

  it('refuses to manufacture an event for a contact outside the account snapshot', async () => {
    viewSnapshot.mockResolvedValue(null);
    const prepareBestEffort = jest.fn();
    const service = new ContactGroupOutboundWebhookBatchService({
      prepareBestEffort,
    } as never);

    await expect(
      service.prepareInTransaction({
        tx: {} as never,
        accountId: 'account-1',
        operationId: 'operation-1',
        operation: 'created',
        contactGroupId: 'cg-1',
        contactGroupName: 'Group',
        affectedContactIds: ['foreign-contact'],
        nextMemberIds: new Set(['foreign-contact']),
      })
    ).rejects.toThrow('outbound_webhook_contact_snapshot_not_found');

    expect(prepareBestEffort).not.toHaveBeenCalled();
  });

  it('marks exact previous snapshots and finalizes only preparing entries', async () => {
    const completePersistedBestEffort = jest.fn(async () => undefined);
    const cancel = jest.fn(async () => undefined);
    const service = new ContactGroupOutboundWebhookBatchService({
      completePersistedBestEffort,
      cancel,
    } as never);
    const tx = { id: 'tx-1' } as never;
    const batch = {
      accountId: 'account-1',
      entries: [
        {
          contactId: 'c-1',
          previousContact: { contact_id: 'c-1' },
          marker: {
            eventId: 'event-1',
            accountId: 'account-1',
            envelope: { id: 'event-1' },
          },
          prepared: {
            eventId: 'event-1',
            state: 'preparing',
            envelope: { id: 'event-1' },
          },
        },
        {
          contactId: 'c-2',
          previousContact: { contact_id: 'c-2' },
          marker: null,
          prepared: {
            eventId: 'event-2',
            state: 'ready',
            envelope: { id: 'event-2' },
          },
        },
      ],
    } as never;

    await service.markAppliedInTransaction(tx, batch);
    await service.completePersistedBestEffort(batch);
    await service.cancelBestEffort(batch);

    expect(markApplied).toHaveBeenNthCalledWith(
      1,
      tx,
      'c-1',
      expect.objectContaining({ eventId: 'event-1' }),
      { contact_id: 'c-1' }
    );
    expect(markApplied).toHaveBeenNthCalledWith(2, tx, 'c-2', null, {
      contact_id: 'c-2',
    });
    expect(completePersistedBestEffort).toHaveBeenCalledTimes(1);
    expect(completePersistedBestEffort).toHaveBeenCalledWith({
      eventId: 'event-1',
      accountId: 'account-1',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('event-1');
  });
});
