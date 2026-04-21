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

  it('throws when group update fails', async () => {
    const repository = new ContactGroupUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb({ txId: 1 })
        ),
      } as never,
      {
        deleteContactGroupAssignmentById: jest.fn(async () => true),
      } as never,
      {
        createContactGroupAssignment: jest.fn(async () => 'cga-1'),
      } as never,
      {
        existsContactGroupAssignmentById: jest.fn(async () => false),
      } as never,
      {
        updateContactGroupById: jest.fn(async () => false),
      } as never
    );

    await expect(
      repository.updateContactGroup(t, 'cg-1', { contacts: [] } as never)
    ).rejects.toThrow('tr_contact_group_update_error');
  });

  it('updates and recreates assignments when successful', async () => {
    const createAssignment = jest.fn(async () => 'cga-1');
    const repository = new ContactGroupUpdaterTransactionRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb({ txId: 1 })
        ),
      } as never,
      {
        deleteContactGroupAssignmentById: jest.fn(async () => true),
      } as never,
      {
        createContactGroupAssignment: createAssignment,
      } as never,
      {
        existsContactGroupAssignmentById: jest.fn(async () => true),
      } as never,
      {
        updateContactGroupById: jest.fn(async () => true),
      } as never
    );

    await expect(
      repository.updateContactGroup(t, 'cg-1', {
        contacts: [{ contact_id: 'c-1' }],
      } as never)
    ).resolves.toBe(true);
    expect(createAssignment).toHaveBeenCalledTimes(1);
  });
});
