import 'reflect-metadata';
import { ContactGroupAssignmentDeleterRepository } from '@core/repositories/contactGroup/ContactGroupAssignmentDeleter.repository';

function createDeleteStep(rowCount?: number | null) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  return { where };
}

describe('ContactGroupAssignmentDeleterRepository', () => {
  it('returns true when delete affects rows', async () => {
    const step = createDeleteStep(2);
    const tx = {
      delete: jest.fn(() => ({ where: step.where })),
    };
    const repository = new ContactGroupAssignmentDeleterRepository({} as never);

    await expect(
      repository.deleteContactGroupAssignmentById(tx as never, 'cg-1')
    ).resolves.toBe(true);
  });

  it('returns false when delete affects no rows', async () => {
    const step = createDeleteStep(0);
    const tx = {
      delete: jest.fn(() => ({ where: step.where })),
    };
    const repository = new ContactGroupAssignmentDeleterRepository({} as never);

    await expect(
      repository.deleteContactGroupAssignmentById(tx as never, 'cg-1')
    ).resolves.toBe(false);
  });
});
