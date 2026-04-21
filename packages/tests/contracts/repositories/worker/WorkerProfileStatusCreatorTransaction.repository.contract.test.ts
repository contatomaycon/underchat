import 'reflect-metadata';
import { WorkerProfileStatusCreatorTransactionRepository } from '@core/repositories/worker/WorkerProfileStatusCreatorTransaction.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mocked-uuid'),
}));

const t = ((key: string) => key) as never;

describe('WorkerProfileStatusCreatorTransactionRepository', () => {
  it('throws when profile status creation fails', async () => {
    const repository = new WorkerProfileStatusCreatorTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback({})),
      } as never,
      {
        createWorkerProfileStatus: jest.fn(async () => null),
      } as never,
      {
        createWorkerProfileStatusContact: jest.fn(async () => 'wpsc-1'),
      } as never,
      {
        deleteWorkerProfileStatusContactByStatusId: jest.fn(async () => true),
      } as never,
      {
        listContactsByAccountId: jest.fn(async () => []),
      } as never,
      {
        listContactsByGroupIds: jest.fn(async () => []),
      } as never
    );

    await expect(
      repository.createWorkerProfileStatus(
        t,
        'account-1',
        {} as never,
        { visibility_type: 'all' } as never
      )
    ).rejects.toThrow('profile_status_creation_failed');
  });

  it('creates status contacts for all visibility', async () => {
    const createWorkerProfileStatusContact = jest.fn(async () => 'wpsc-1');
    const listContactsByAccountId = jest.fn(async () => ['c-1', 'c-2']);
    const repository = new WorkerProfileStatusCreatorTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback({ tx: true })),
      } as never,
      {
        createWorkerProfileStatus: jest.fn(async () => 'wps-1'),
      } as never,
      {
        createWorkerProfileStatusContact,
      } as never,
      {
        deleteWorkerProfileStatusContactByStatusId: jest.fn(async () => true),
      } as never,
      {
        listContactsByAccountId,
      } as never,
      {
        listContactsByGroupIds: jest.fn(async () => []),
      } as never
    );

    await expect(
      repository.createWorkerProfileStatus(
        t,
        'account-1',
        {} as never,
        { visibility_type: 'all' } as never
      )
    ).resolves.toBe('wps-1');

    expect(listContactsByAccountId).toHaveBeenCalledWith('account-1');
    expect(createWorkerProfileStatusContact).toHaveBeenCalledTimes(2);
  });

  it('throws when contact groups visibility has no groups', async () => {
    const repository = new WorkerProfileStatusCreatorTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback({})),
      } as never,
      {
        createWorkerProfileStatus: jest.fn(async () => 'wps-1'),
      } as never,
      {
        createWorkerProfileStatusContact: jest.fn(async () => 'wpsc-1'),
      } as never,
      {
        deleteWorkerProfileStatusContactByStatusId: jest.fn(async () => true),
      } as never,
      {
        listContactsByAccountId: jest.fn(async () => []),
      } as never,
      {
        listContactsByGroupIds: jest.fn(async () => []),
      } as never
    );

    await expect(
      repository.createWorkerProfileStatus(
        t,
        'account-1',
        {} as never,
        { visibility_type: 'contact_groups', contact_group_ids: [] } as never
      )
    ).rejects.toThrow('contact_groups_required');
  });

  it('throws when contacts visibility has no contact ids', async () => {
    const repository = new WorkerProfileStatusCreatorTransactionRepository(
      {
        transaction: jest.fn(async (callback) => callback({})),
      } as never,
      {
        createWorkerProfileStatus: jest.fn(async () => 'wps-1'),
      } as never,
      {
        createWorkerProfileStatusContact: jest.fn(async () => 'wpsc-1'),
      } as never,
      {
        deleteWorkerProfileStatusContactByStatusId: jest.fn(async () => true),
      } as never,
      {
        listContactsByAccountId: jest.fn(async () => []),
      } as never,
      {
        listContactsByGroupIds: jest.fn(async () => []),
      } as never
    );

    await expect(
      repository.createWorkerProfileStatus(
        t,
        'account-1',
        {} as never,
        { visibility_type: 'contacts', contact_ids: [] } as never
      )
    ).rejects.toThrow('contacts_required');
  });
});
