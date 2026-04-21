import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { PermissionAssignmentCreatorRepository } from '@core/repositories/permission/PermissionAssignmentCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('PermissionAssignmentCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue(
      'permission-assignment-id'
    );
  });

  it('creates permission assignment and returns id', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const insert = jest.fn(() => ({ values }));
    const repository = new PermissionAssignmentCreatorRepository({
      insert,
    } as never);

    await expect(
      repository.createPermissionAssignment('user-1', 'role-1')
    ).resolves.toBe('permission-assignment-id');
  });

  it('returns null when createPermissionAssignment has no result', async () => {
    const execute = jest.fn(async () => null);
    const values = jest.fn(() => ({ execute }));
    const insert = jest.fn(() => ({ values }));
    const repository = new PermissionAssignmentCreatorRepository({
      insert,
    } as never);

    await expect(
      repository.createPermissionAssignment('user-1', 'role-1')
    ).resolves.toBeNull();
  });

  it('creates permission assignment in transaction and returns id', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const insert = jest.fn(() => ({ values }));

    const repository = new PermissionAssignmentCreatorRepository({} as never);

    await expect(
      repository.createPermissionAssignmentInTransaction(
        { insert } as never,
        'user-1',
        'role-1',
        'acc-1'
      )
    ).resolves.toBe('permission-assignment-id');
  });
});
