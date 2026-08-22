import 'reflect-metadata';
import type { TFunction } from 'i18next';
import { ContactGroupUpdaterTransactionRepository } from '@core/repositories/contactGroup/ContactGroupUpdaterTransaction.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mock-uuid'),
}));

describe('ContactGroupUpdaterTransactionRepository', () => {
  const t = ((key: string) => `tr_${key}`) as unknown as TFunction<
    'translation',
    undefined
  >;

  const createTx = (selectResults: unknown[][]) => {
    let selectIndex = 0;
    return {
      txId: 1,
      select: jest.fn(() => {
        const rows = selectResults[selectIndex++] ?? [];
        const chain = {} as Record<string, jest.Mock>;
        for (const method of ['from', 'where', 'for', 'limit', 'innerJoin']) {
          chain[method] = jest.fn(() => chain);
        }
        chain.execute = jest.fn(async () => rows);
        return chain;
      }),
    };
  };

  const createOutboundWebhookBatch = () => {
    const preparedBatch = { accountId: 'account-1', entries: [] };
    return {
      preparedBatch,
      prepareInTransaction: jest.fn(async () => preparedBatch),
      markAppliedInTransaction: jest.fn(async () => undefined),
      completePersistedBestEffort: jest.fn(async () => undefined),
      cancelBestEffort: jest.fn(async () => undefined),
    };
  };

  const createRepository = ({
    selectResults = [[{ id: 'cg-1', name: 'Group' }], [], []],
    updateResult = true,
    deleteResult = true,
    createResult = 'cga-1',
  }: {
    selectResults?: unknown[][];
    updateResult?: boolean;
    deleteResult?: boolean;
    createResult?: string | null;
  } = {}) => {
    const tx = createTx(selectResults);
    const deleteAssignment = jest.fn(async () => deleteResult);
    const createAssignment = jest.fn(async () => createResult);
    const updateGroup = jest.fn(async () => updateResult);
    const batch = createOutboundWebhookBatch();
    const repository = new ContactGroupUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb(tx)
        ),
      } as never,
      {
        deleteContactGroupAssignmentByGroupAndContact: deleteAssignment,
      } as never,
      {
        createContactGroupAssignment: createAssignment,
      } as never,
      {
        updateContactGroupById: updateGroup,
      } as never,
      batch as never
    );

    return {
      repository,
      tx,
      deleteAssignment,
      createAssignment,
      updateGroup,
      batch,
    };
  };

  it('cancels prepared webhook intents when the group update fails', async () => {
    const { repository, batch } = createRepository({ updateResult: false });

    await expect(
      repository.updateContactGroup(
        t,
        'cg-1',
        { contacts: [] } as never,
        'account-1'
      )
    ).rejects.toThrow('tr_contact_group_update_error');

    expect(batch.cancelBestEffort).toHaveBeenCalledWith(batch.preparedBatch);
    expect(batch.markAppliedInTransaction).not.toHaveBeenCalled();
    expect(batch.completePersistedBestEffort).not.toHaveBeenCalled();
  });

  it('applies only the membership delta and emits the union of affected contacts', async () => {
    const { repository, deleteAssignment, createAssignment, batch, tx } =
      createRepository({
        selectResults: [
          [{ id: 'cg-1', name: 'Group' }],
          [{ contactId: 'c-1' }, { contactId: 'c-2' }],
          [{ contactId: 'c-1' }, { contactId: 'c-2' }],
        ],
      });

    await expect(
      repository.updateContactGroup(
        t,
        'cg-1',
        {
          contacts: [{ contact_id: 'c-2' }, { contact_id: 'c-3' }],
        } as never,
        'account-1',
        'user-1'
      )
    ).resolves.toBe(true);

    expect(deleteAssignment).toHaveBeenCalledTimes(1);
    expect(deleteAssignment).toHaveBeenCalledWith(tx, 'cg-1', 'c-1');
    expect(createAssignment).toHaveBeenCalledTimes(1);
    expect(createAssignment).toHaveBeenCalledWith(
      tx,
      'cg-1',
      'c-3',
      'account-1'
    );
    expect(batch.prepareInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        accountId: 'account-1',
        actorUserId: 'user-1',
        operation: 'updated',
        contactGroupId: 'cg-1',
        contactGroupName: 'Group',
        affectedContactIds: expect.arrayContaining(['c-1', 'c-2', 'c-3']),
        nextMemberIds: new Set(['c-2', 'c-3']),
      })
    );
    expect(batch.markAppliedInTransaction).toHaveBeenCalledWith(
      tx,
      batch.preparedBatch
    );
    expect(batch.completePersistedBestEffort).toHaveBeenCalledWith(
      batch.preparedBatch
    );
    expect(batch.cancelBestEffort).not.toHaveBeenCalled();
  });

  it('preserves memberships when contacts is omitted', async () => {
    const { repository, deleteAssignment, createAssignment, batch } =
      createRepository({
        selectResults: [
          [{ id: 'cg-1', name: 'Group' }],
          [{ contactId: 'c-1' }],
          [{ contactId: 'c-1' }],
        ],
      });

    await expect(
      repository.updateContactGroup(
        t,
        'cg-1',
        { description: 'Only metadata changed' } as never,
        'account-1'
      )
    ).resolves.toBe(true);

    expect(deleteAssignment).not.toHaveBeenCalled();
    expect(createAssignment).not.toHaveBeenCalled();
    expect(batch.prepareInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        affectedContactIds: [],
        nextMemberIds: new Set(['c-1']),
      })
    );
  });

  it('emits every current member when the public group name changes', async () => {
    const { repository, batch } = createRepository({
      selectResults: [
        [{ id: 'cg-1', name: 'Old name' }],
        [{ contactId: 'c-2' }, { contactId: 'c-1' }],
        [{ contactId: 'c-2' }, { contactId: 'c-1' }],
      ],
    });

    await expect(
      repository.updateContactGroup(
        t,
        'cg-1',
        { name: 'New name' } as never,
        'account-1'
      )
    ).resolves.toBe(true);

    expect(batch.prepareInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        contactGroupName: 'New name',
        affectedContactIds: expect.arrayContaining(['c-1', 'c-2']),
        nextMemberIds: new Set(['c-1', 'c-2']),
      })
    );
  });

  it('rejects an account-scoped group that does not exist', async () => {
    const { repository, updateGroup, batch } = createRepository({
      selectResults: [[], [], []],
    });

    await expect(
      repository.updateContactGroup(
        t,
        'cg-missing',
        { name: 'Name' } as never,
        'account-1'
      )
    ).rejects.toThrow('tr_contact_group_not_found');

    expect(updateGroup).not.toHaveBeenCalled();
    expect(batch.prepareInTransaction).not.toHaveBeenCalled();
    expect(batch.cancelBestEffort).toHaveBeenCalledWith(null);
  });
});
