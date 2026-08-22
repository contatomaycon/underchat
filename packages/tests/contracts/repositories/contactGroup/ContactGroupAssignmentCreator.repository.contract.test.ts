import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { ContactGroupAssignmentCreatorRepository } from '@core/repositories/contactGroup/ContactGroupAssignmentCreator.repository';

jest.mock('@core/repositories/contact/contactOutboundWebhookOutbox', () => ({
  lockContactOutboundWebhookSnapshotInTransaction: jest.fn(async () => null),
  markContactOutboundWebhookAppliedInTransaction: jest.fn(async () => {}),
}));

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createInsertStep(result: unknown) {
  const execute = jest.fn(async () => result);
  const chain = {
    onConflictDoNothing: jest.fn(),
    returning: jest.fn(),
    execute,
  };
  chain.onConflictDoNothing.mockReturnValue(chain);
  chain.returning.mockReturnValue(chain);
  const values = jest.fn(() => chain);

  return { values };
}

function createGroupSelect() {
  const execute = jest.fn(async () => [{ id: 'cg-1' }]);
  const chain = {} as Record<string, jest.Mock>;
  for (const method of ['from', 'where', 'for', 'limit']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.execute = execute;
  return jest.fn(() => chain);
}

describe('ContactGroupAssignmentCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('cga-1');
  });

  it('creates assignment in transaction and directly in db', async () => {
    const txInsert = createInsertStep([{ id: 'cga-1' }]);
    const tx = {
      insert: jest.fn(() => ({ values: txInsert.values })),
      select: createGroupSelect(),
    };
    const repository = new ContactGroupAssignmentCreatorRepository({
      transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx)
      ),
    } as never);

    await expect(
      repository.createContactGroupAssignment(
        tx as never,
        'cg-1',
        'c-1',
        'account-1'
      )
    ).resolves.toBe('cga-1');
    await expect(
      repository.createContactGroupAssignmentDirectly(
        'cg-1',
        'c-1',
        'account-1'
      )
    ).resolves.toBe('cga-1');
  });

  it('returns null when insert result is empty', async () => {
    const txInsert = createInsertStep([]);
    const repository = new ContactGroupAssignmentCreatorRepository({
      insert: jest.fn(),
    } as never);
    const tx = {
      insert: jest.fn(() => ({ values: txInsert.values })),
      select: createGroupSelect(),
    };

    await expect(
      repository.createContactGroupAssignment(
        tx as never,
        'cg-1',
        'c-1',
        'account-1'
      )
    ).resolves.toBeNull();
  });
});
