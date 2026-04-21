import 'reflect-metadata';
import type { TFunction } from 'i18next';
import { ContactGroupDeleterTransactionRepository } from '@core/repositories/contactGroup/ContactGroupDeleterTransaction.repository';

describe('ContactGroupDeleterTransactionRepository', () => {
  const t = ((key: string) => `tr_${key}`) as unknown as TFunction<
    'translation',
    undefined
  >;

  it('throws when assignment deletion fails', async () => {
    const repository = new ContactGroupDeleterTransactionRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb({ txId: 1 })
        ),
      } as never,
      {
        deleteContactGroupAssignmentById: jest.fn(async () => false),
      } as never,
      {
        deleteContactGroupById: jest.fn(async () => true),
      } as never,
      {
        existsContactGroupAssignmentById: jest.fn(async () => true),
      } as never
    );

    await expect(repository.deleteContactGroup(t, 'cg-1')).rejects.toThrow(
      'tr_contact_group_assignment_deleter_error'
    );
  });

  it('returns true when group is deleted successfully', async () => {
    const repository = new ContactGroupDeleterTransactionRepository(
      {
        transaction: jest.fn(async (cb: (txArg: unknown) => Promise<unknown>) =>
          cb({ txId: 1 })
        ),
      } as never,
      {
        deleteContactGroupAssignmentById: jest.fn(async () => true),
      } as never,
      {
        deleteContactGroupById: jest.fn(async () => true),
      } as never,
      {
        existsContactGroupAssignmentById: jest.fn(async () => false),
      } as never
    );

    await expect(repository.deleteContactGroup(t, 'cg-1')).resolves.toBe(true);
  });
});
