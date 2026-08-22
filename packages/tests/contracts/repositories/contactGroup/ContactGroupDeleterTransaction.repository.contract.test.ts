import 'reflect-metadata';
import type { TFunction } from 'i18next';
import { ContactGroupDeleterTransactionRepository } from '@core/repositories/contactGroup/ContactGroupDeleterTransaction.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mock-uuid'),
}));

describe('ContactGroupDeleterTransactionRepository', () => {
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
    assignmentDeleteResult = true,
    groupDeleteResult = true,
  }: {
    selectResults?: unknown[][];
    assignmentDeleteResult?: boolean;
    groupDeleteResult?: boolean;
  } = {}) => {
    const tx = createTx(selectResults);
    const deleteAssignments = jest.fn(async () => assignmentDeleteResult);
    const deleteGroup = jest.fn(async () => groupDeleteResult);
    const batch = createOutboundWebhookBatch();
    const repository = new ContactGroupDeleterTransactionRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb(tx)
        ),
      } as never,
      {
        deleteContactGroupAssignmentById: deleteAssignments,
      } as never,
      {
        deleteContactGroupById: deleteGroup,
      } as never,
      batch as never
    );

    return { repository, tx, deleteAssignments, deleteGroup, batch };
  };

  it('cancels prepared webhook intents when assignment deletion fails', async () => {
    const { repository, batch } = createRepository({
      selectResults: [
        [{ id: 'cg-1', name: 'Group' }],
        [{ contactId: 'c-1' }],
        [{ contactId: 'c-1' }],
      ],
      assignmentDeleteResult: false,
    });

    await expect(
      repository.deleteContactGroup(t, 'cg-1', 'account-1')
    ).rejects.toThrow('tr_contact_group_assignment_deleter_error');

    expect(batch.cancelBestEffort).toHaveBeenCalledWith(batch.preparedBatch);
    expect(batch.markAppliedInTransaction).not.toHaveBeenCalled();
    expect(batch.completePersistedBestEffort).not.toHaveBeenCalled();
  });

  it('prepares every valid member, persists the marker and completes after commit', async () => {
    const { repository, tx, deleteAssignments, deleteGroup, batch } =
      createRepository({
        selectResults: [
          [{ id: 'cg-1', name: 'Customers' }],
          [{ contactId: 'c-2' }, { contactId: 'c-1' }],
          [{ contactId: 'c-2' }, { contactId: 'c-1' }],
        ],
      });

    await expect(
      repository.deleteContactGroup(t, 'cg-1', 'account-1', 'user-1')
    ).resolves.toBe(true);

    expect(batch.prepareInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        accountId: 'account-1',
        actorUserId: 'user-1',
        operation: 'deleted',
        contactGroupId: 'cg-1',
        contactGroupName: 'Customers',
        affectedContactIds: expect.arrayContaining(['c-1', 'c-2']),
        nextMemberIds: new Set(),
      })
    );
    expect(deleteAssignments).toHaveBeenCalledWith(tx, 'cg-1');
    expect(deleteGroup).toHaveBeenCalledWith(tx, 'cg-1', 'account-1');
    expect(batch.markAppliedInTransaction).toHaveBeenCalledWith(
      tx,
      batch.preparedBatch
    );
    expect(batch.completePersistedBestEffort).toHaveBeenCalledWith(
      batch.preparedBatch
    );
    expect(batch.cancelBestEffort).not.toHaveBeenCalled();
  });

  it('deletes an empty group without issuing an empty assignment delete', async () => {
    const { repository, deleteAssignments, deleteGroup, batch } =
      createRepository();

    await expect(
      repository.deleteContactGroup(t, 'cg-1', 'account-1')
    ).resolves.toBe(true);

    expect(deleteAssignments).not.toHaveBeenCalled();
    expect(deleteGroup).toHaveBeenCalledTimes(1);
    expect(batch.prepareInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ affectedContactIds: [] })
    );
  });

  it('cancels after a group deletion failure', async () => {
    const { repository, batch } = createRepository({
      groupDeleteResult: false,
    });

    await expect(
      repository.deleteContactGroup(t, 'cg-1', 'account-1')
    ).rejects.toThrow('tr_contact_group_deleter_error');

    expect(batch.cancelBestEffort).toHaveBeenCalledWith(batch.preparedBatch);
    expect(batch.markAppliedInTransaction).not.toHaveBeenCalled();
  });

  it('rejects an account-scoped group that does not exist', async () => {
    const { repository, deleteGroup, batch } = createRepository({
      selectResults: [[], [], []],
    });

    await expect(
      repository.deleteContactGroup(t, 'cg-missing', 'account-1')
    ).rejects.toThrow('tr_contact_group_not_found');

    expect(deleteGroup).not.toHaveBeenCalled();
    expect(batch.prepareInTransaction).not.toHaveBeenCalled();
    expect(batch.cancelBestEffort).toHaveBeenCalledWith(null);
  });
});
