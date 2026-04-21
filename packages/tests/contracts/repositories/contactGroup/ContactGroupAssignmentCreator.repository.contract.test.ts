import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { ContactGroupAssignmentCreatorRepository } from '@core/repositories/contactGroup/ContactGroupAssignmentCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createInsertStep(result: unknown) {
  const execute = jest.fn(async () => result);
  const values = jest.fn(() => ({ execute }));

  return { values };
}

describe('ContactGroupAssignmentCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('cga-1');
  });

  it('creates assignment in transaction and directly in db', async () => {
    const txInsert = createInsertStep({ rowCount: 1 });
    const dbInsert = createInsertStep({ rowCount: 1 });
    const repository = new ContactGroupAssignmentCreatorRepository({
      insert: jest.fn(() => ({ values: dbInsert.values })),
    } as never);
    const tx = {
      insert: jest.fn(() => ({ values: txInsert.values })),
    };

    await expect(
      repository.createContactGroupAssignment(tx as never, 'cg-1', 'c-1')
    ).resolves.toBe('cga-1');
    await expect(
      repository.createContactGroupAssignmentDirectly('cg-1', 'c-1')
    ).resolves.toBe('cga-1');
  });

  it('returns null when insert result is empty', async () => {
    const txInsert = createInsertStep(null);
    const repository = new ContactGroupAssignmentCreatorRepository({
      insert: jest.fn(),
    } as never);
    const tx = {
      insert: jest.fn(() => ({ values: txInsert.values })),
    };

    await expect(
      repository.createContactGroupAssignment(tx as never, 'cg-1', 'c-1')
    ).resolves.toBeNull();
  });
});
