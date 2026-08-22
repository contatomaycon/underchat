import 'reflect-metadata';
import type { SQL } from 'drizzle-orm';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import {
  contactChannel,
  contactGroupAssignment,
  contactLabelTemplate,
} from '@core/models';

const mockLockContact = jest.fn();
const mockMarkContact = jest.fn();
const mockViewContact = jest.fn();

jest.mock('@core/repositories/contact/contactOutboundWebhookOutbox', () => ({
  lockContactOutboundWebhookSnapshotInTransaction: (...args: unknown[]) =>
    mockLockContact(...args),
  markContactOutboundWebhookAppliedInTransaction: (...args: unknown[]) =>
    mockMarkContact(...args),
  viewContactOutboundWebhookSnapshotWithExecutor: (...args: unknown[]) =>
    mockViewContact(...args),
}));

import { ContactUpdaterRepository } from '@core/repositories/contact/ContactUpdater.repository';
import { ContactDeleterRepository } from '@core/repositories/contact/ContactDeleter.repository';
import { ContactLabelTemplateCreatorRepository } from '@core/repositories/contact/ContactLabelTemplateCreator.repository';
import { ContactLabelTemplateDeleterRepository } from '@core/repositories/contact/ContactLabelTemplateDeleter.repository';
import { ContactGroupAssignmentCreatorRepository } from '@core/repositories/contactGroup/ContactGroupAssignmentCreator.repository';

const accountId = '01900000-0000-7000-8000-000000000001';
const contactId = '01900000-0000-7000-8000-000000000002';
const eventId = '01900000-0000-7000-8000-000000000003';
const labelId = '01900000-0000-7000-8000-000000000004';
const groupId = '01900000-0000-7000-8000-000000000005';
const assignmentId = '01900000-0000-7000-8000-000000000006';

const marker = {
  eventId,
  accountId,
  envelope: {
    id: eventId,
    type: 'contact.updated' as const,
    api_version: '1' as const,
    occurred_at: '2026-07-10T20:00:00.000Z',
    account_id: accountId,
    aggregate: { type: 'contact' as const, id: contactId },
    data: { contact: { contact_id: contactId } },
    previous: null,
    context: {
      source: 'contract_test',
      channel_ids: ['01900000-0000-7000-8000-000000000004'],
    },
  },
};

const previous = {
  contact_id: contactId,
  account_id: accountId,
  name: 'Previous',
};

function createTransactionHarness(tx: Record<string, unknown>) {
  let committed = false;
  let rolledBack = false;
  const transaction = jest.fn(
    async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      try {
        const result = await callback(tx);
        committed = true;
        return result;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    }
  );

  return {
    transaction,
    committed: () => committed,
    rolledBack: () => rolledBack,
  };
}

function createUpdateStep(rowCount = 1) {
  let condition: SQL | undefined;
  const execute = jest.fn(async () => ({ rowCount }));
  const chain = {} as {
    set: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };
  chain.set = jest.fn(() => chain);
  chain.where = jest.fn((where: SQL) => {
    condition = where;
    return chain;
  });
  chain.execute = execute;
  return {
    update: jest.fn(() => chain),
    execute,
    condition: () => condition,
  };
}

function createInsertStep(
  result: Array<{ id: string }> = [{ id: assignmentId }]
) {
  const execute = jest.fn(async () => result);
  const chain = {} as {
    values: jest.Mock;
    onConflictDoNothing: jest.Mock;
    returning: jest.Mock;
    execute: jest.Mock;
  };
  chain.values = jest.fn(() => chain);
  chain.onConflictDoNothing = jest.fn(() => chain);
  chain.returning = jest.fn(() => chain);
  chain.execute = execute;
  return { insert: jest.fn(() => chain), execute };
}

function createDeleteStep(rowCount = 1) {
  const execute = jest.fn(async () => ({ rowCount }));
  const chain = {} as {
    where: jest.Mock;
    execute: jest.Mock;
  };
  chain.where = jest.fn(() => chain);
  chain.execute = execute;
  return { delete: jest.fn(() => chain), execute };
}

function createGroupSelectStep(found = true) {
  const execute = jest.fn(async () => (found ? [{ id: groupId }] : []));
  const chain = {} as Record<string, jest.Mock>;
  for (const method of ['from', 'where', 'for', 'limit']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.execute = execute;
  return { select: jest.fn(() => chain), execute };
}

describe('contact repository -> transactional outbox marker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLockContact.mockResolvedValue(previous);
    mockMarkContact.mockResolvedValue(undefined);
  });

  it('updates the contact first, applies its relations, and marks the final snapshot in the same transaction', async () => {
    const updateStep = createUpdateStep();
    const tx = { update: updateStep.update };
    const transaction = createTransactionHarness(tx);
    const deleteLabels = jest.fn(async () => true);
    const createLabel = jest.fn(async () => assignmentId);
    const repository = new ContactUpdaterRepository(
      { transaction: transaction.transaction } as never,
      { deleteContactLabelTemplatesByContactId: deleteLabels } as never,
      { createContactLabelTemplate: createLabel } as never,
      { updateContactChannelsInTransaction: jest.fn(async () => true) } as never
    );

    await expect(
      repository.updateContactById(
        contactId,
        { name: 'Final', label_template_ids: [labelId] } as never,
        accountId,
        marker
      )
    ).resolves.toBe(true);

    expect(mockLockContact).toHaveBeenCalledWith(
      tx,
      contactId,
      marker,
      accountId
    );
    expect(deleteLabels).toHaveBeenCalledWith(tx, contactId);
    expect(createLabel).toHaveBeenCalledWith(tx, contactId, labelId, accountId);
    expect(mockMarkContact).toHaveBeenCalledWith(
      tx,
      contactId,
      marker,
      previous
    );
    expect(updateStep.execute.mock.invocationCallOrder[0]).toBeLessThan(
      deleteLabels.mock.invocationCallOrder[0] ?? 0
    );
    expect(createLabel.mock.invocationCallOrder[0]).toBeLessThan(
      mockMarkContact.mock.invocationCallOrder[0] ?? 0
    );
    expect(transaction.committed()).toBe(true);
    expect(transaction.rolledBack()).toBe(false);
  });

  it('propagates marker failure so the transaction cannot commit the domain update', async () => {
    const updateStep = createUpdateStep();
    const tx = { update: updateStep.update };
    const transaction = createTransactionHarness(tx);
    const markerError = new Error(
      'outbound_webhook_event_domain_marker_not_updated'
    );
    mockMarkContact.mockRejectedValueOnce(markerError);
    const repository = new ContactUpdaterRepository(
      { transaction: transaction.transaction } as never,
      { deleteContactLabelTemplatesByContactId: jest.fn() } as never,
      { createContactLabelTemplate: jest.fn() } as never,
      { updateContactChannelsInTransaction: jest.fn() } as never
    );

    await expect(
      repository.updateContactById(
        contactId,
        { name: 'Must roll back' } as never,
        accountId,
        marker
      )
    ).rejects.toBe(markerError);

    expect(updateStep.execute).toHaveBeenCalledTimes(1);
    expect(transaction.committed()).toBe(false);
    expect(transaction.rolledBack()).toBe(true);
  });

  it('scopes and soft-deletes before dependent rows, then marks deletion with its locked previous snapshot', async () => {
    const updateStep = createUpdateStep();
    const tx = { update: updateStep.update };
    const transaction = createTransactionHarness(tx);
    const deleteLabels = jest.fn(async () => true);
    const repository = new ContactDeleterRepository(
      { transaction: transaction.transaction } as never,
      { deleteContactLabelTemplatesByContactId: deleteLabels } as never
    );

    await expect(
      repository.deleteContactById(contactId, accountId, marker)
    ).resolves.toBe(true);

    const query = new PgDialect().sqlToQuery(updateStep.condition() as SQL);
    expect(query.sql).toContain('"deleted_at" is null');
    expect(query.params).toEqual(
      expect.arrayContaining([contactId, accountId])
    );
    expect(updateStep.execute.mock.invocationCallOrder[0]).toBeLessThan(
      deleteLabels.mock.invocationCallOrder[0] ?? 0
    );
    expect(deleteLabels.mock.invocationCallOrder[0]).toBeLessThan(
      mockMarkContact.mock.invocationCallOrder[0] ?? 0
    );
    expect(mockMarkContact).toHaveBeenCalledWith(
      tx,
      contactId,
      marker,
      previous
    );
  });

  it('rejects a group from another account before locking or inserting the contact assignment', async () => {
    const insertStep = createInsertStep();
    const groupSelect = createGroupSelectStep(false);
    const tx = { insert: insertStep.insert, select: groupSelect.select };
    const transaction = createTransactionHarness(tx);
    const repository = new ContactGroupAssignmentCreatorRepository({
      transaction: transaction.transaction,
    } as never);

    await expect(
      repository.createContactGroupAssignmentDirectly(
        groupId,
        contactId,
        accountId,
        assignmentId
      )
    ).rejects.toThrow('contact_group_account_mismatch');

    expect(mockLockContact).not.toHaveBeenCalled();
    expect(insertStep.execute).not.toHaveBeenCalled();
    expect(mockMarkContact).not.toHaveBeenCalled();
    expect(transaction.rolledBack()).toBe(true);
  });

  it('locks and marks a label assignment around its insert transaction', async () => {
    const insertStep = createInsertStep();
    const labelSelect = createGroupSelectStep();
    const tx = { insert: insertStep.insert, select: labelSelect.select };
    const transaction = createTransactionHarness(tx);
    const repository = new ContactLabelTemplateCreatorRepository({
      transaction: transaction.transaction,
    } as never);

    await expect(
      repository.createContactLabelTemplateWithoutTransaction(
        contactId,
        labelId,
        accountId,
        assignmentId,
        marker
      )
    ).resolves.toBe(assignmentId);

    expect(mockLockContact).toHaveBeenCalledWith(
      tx,
      contactId,
      marker,
      accountId
    );
    expect(insertStep.execute.mock.invocationCallOrder[0]).toBeLessThan(
      mockMarkContact.mock.invocationCallOrder[0] ?? 0
    );
    expect(mockMarkContact).toHaveBeenCalledWith(
      tx,
      contactId,
      marker,
      previous
    );
  });

  it('does not mark a duplicate label assignment that lost the unique-index race', async () => {
    const insertStep = createInsertStep([]);
    const labelSelect = createGroupSelectStep();
    const tx = { insert: insertStep.insert, select: labelSelect.select };
    const transaction = createTransactionHarness(tx);
    const repository = new ContactLabelTemplateCreatorRepository({
      transaction: transaction.transaction,
    } as never);

    await expect(
      repository.createContactLabelTemplateWithoutTransaction(
        contactId,
        labelId,
        accountId,
        assignmentId,
        marker
      )
    ).resolves.toBeNull();
    expect(mockMarkContact).not.toHaveBeenCalled();
  });

  it('rejects a label from another account before locking or inserting its assignment', async () => {
    const insertStep = createInsertStep();
    const labelSelect = createGroupSelectStep(false);
    const tx = { insert: insertStep.insert, select: labelSelect.select };
    const transaction = createTransactionHarness(tx);
    const repository = new ContactLabelTemplateCreatorRepository({
      transaction: transaction.transaction,
    } as never);

    await expect(
      repository.createContactLabelTemplateWithoutTransaction(
        contactId,
        labelId,
        accountId,
        assignmentId
      )
    ).rejects.toThrow('label_template_account_mismatch');

    expect(mockLockContact).not.toHaveBeenCalled();
    expect(insertStep.execute).not.toHaveBeenCalled();
    expect(mockMarkContact).not.toHaveBeenCalled();
    expect(transaction.rolledBack()).toBe(true);
  });

  it('locks and marks label removal only after a row was actually deleted', async () => {
    const deleteStep = createDeleteStep();
    const labelSelect = createGroupSelectStep();
    const tx = { delete: deleteStep.delete, select: labelSelect.select };
    const transaction = createTransactionHarness(tx);
    const repository = new ContactLabelTemplateDeleterRepository({
      transaction: transaction.transaction,
    } as never);

    await expect(
      repository.deleteContactLabelTemplateByContactIdAndLabelTemplateId(
        contactId,
        labelId,
        accountId,
        marker
      )
    ).resolves.toBe(true);

    expect(mockLockContact).toHaveBeenCalledWith(
      tx,
      contactId,
      marker,
      accountId
    );
    expect(deleteStep.execute.mock.invocationCallOrder[0]).toBeLessThan(
      mockMarkContact.mock.invocationCallOrder[0] ?? 0
    );
    expect(mockMarkContact).toHaveBeenCalledWith(
      tx,
      contactId,
      marker,
      previous
    );
  });

  it('locks and marks a group assignment around its insert transaction', async () => {
    const insertStep = createInsertStep();
    const groupSelect = createGroupSelectStep();
    const tx = { insert: insertStep.insert, select: groupSelect.select };
    const transaction = createTransactionHarness(tx);
    const repository = new ContactGroupAssignmentCreatorRepository({
      transaction: transaction.transaction,
    } as never);

    await expect(
      repository.createContactGroupAssignmentDirectly(
        groupId,
        contactId,
        accountId,
        assignmentId,
        marker
      )
    ).resolves.toBe(assignmentId);

    expect(mockLockContact).toHaveBeenCalledWith(
      tx,
      contactId,
      marker,
      accountId
    );
    expect(insertStep.execute.mock.invocationCallOrder[0]).toBeLessThan(
      mockMarkContact.mock.invocationCallOrder[0] ?? 0
    );
    expect(mockMarkContact).toHaveBeenCalledWith(
      tx,
      contactId,
      marker,
      previous
    );
  });

  it('models label, group and channel assignments as unique sets', () => {
    const uniqueColumnNames = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table)
        .indexes.filter((index) => index.config.unique)
        .map((index) =>
          index.config.columns.map((column) =>
            'name' in column ? column.name : null
          )
        );

    expect(uniqueColumnNames(contactLabelTemplate)).toContainEqual([
      'contact_id',
      'label_template_id',
    ]);
    expect(uniqueColumnNames(contactGroupAssignment)).toContainEqual([
      'contact_id',
      'contact_group_id',
    ]);
    expect(uniqueColumnNames(contactChannel)).toContainEqual([
      'contact_id',
      'channel_id',
    ]);
  });
});
