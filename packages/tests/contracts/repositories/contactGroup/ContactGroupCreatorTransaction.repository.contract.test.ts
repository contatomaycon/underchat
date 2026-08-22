import 'reflect-metadata';
import type { TFunction } from 'i18next';
import { ContactGroupCreatorTransactionRepository } from '@core/repositories/contactGroup/ContactGroupCreatorTransaction.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mock-uuid'),
}));

describe('ContactGroupCreatorTransactionRepository', () => {
  const t = ((key: string) => `tr_${key}`) as unknown as TFunction<
    'translation',
    undefined
  >;
  const createOutboundWebhookBatch = () => ({
    prepareInTransaction: jest.fn(async () => ({
      accountId: 'acc-1',
      entries: [],
    })),
    markAppliedInTransaction: jest.fn(async () => undefined),
    completePersistedBestEffort: jest.fn(async () => undefined),
    cancelBestEffort: jest.fn(async () => undefined),
  });

  it('throws translated error when group creation fails', async () => {
    const dbRw = {
      transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
        cb({ txId: 1 })
      ),
    };
    const repository = new ContactGroupCreatorTransactionRepository(
      dbRw as never,
      {
        createContactGroup: jest.fn(async () => null),
      } as never,
      {
        createContactGroupAssignment: jest.fn(),
      } as never,
      createOutboundWebhookBatch() as never
    );

    await expect(
      repository.createContactGroup(t, 'acc-1', { contacts: [] } as never)
    ).rejects.toThrow('tr_contact_group_creation_failed');
  });

  it('creates group and assignments in a transaction', async () => {
    const createAssignment = jest.fn(async () => 'cga-1');
    const repository = new ContactGroupCreatorTransactionRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb({ txId: 1 })
        ),
      } as never,
      {
        createContactGroup: jest.fn(async () => 'cg-1'),
      } as never,
      {
        createContactGroupAssignment: createAssignment,
      } as never,
      createOutboundWebhookBatch() as never
    );

    await expect(
      repository.createContactGroup(t, 'acc-1', {
        contacts: [{ contact_id: 'c-1' }, { contact_id: 'c-2' }],
      } as never)
    ).resolves.toBe(true);
    expect(createAssignment).toHaveBeenCalledTimes(2);
  });
});
