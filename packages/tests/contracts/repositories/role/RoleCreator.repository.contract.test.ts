import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { RoleCreatorRepository } from '@core/repositories/role/RoleCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('RoleCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('role-id');
  });

  it('creates role and returns permission_role_id', async () => {
    const returning = jest.fn(async () => [{ permission_role_id: 'role-id' }]);
    const roleValues = jest.fn(() => ({ returning }));
    const permissionValues = jest.fn(async () => undefined);
    const insert = jest
      .fn()
      .mockReturnValueOnce({ values: roleValues })
      .mockReturnValueOnce({ values: permissionValues });
    const limit = jest.fn(async () => [
      { permission_action_id: 'transfer-permission-id' },
    ]);
    const where = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where }));
    const select = jest.fn(() => ({ from }));
    const transaction = jest.fn(async (callback) =>
      callback({ insert, select })
    );
    const repository = new RoleCreatorRepository({ transaction } as never);

    await expect(
      repository.createRole('Admin', 'acc-1', 'Descrição')
    ).resolves.toEqual({ permission_role_id: 'role-id' });

    expect(roleValues).toHaveBeenCalledWith({
      permission_role_id: 'role-id',
      account_id: 'acc-1',
      name: 'Admin',
      description: 'Descrição',
    });
    expect(permissionValues).toHaveBeenCalledWith({
      permission_role_action_id: 'role-id',
      permission_action_id: 'transfer-permission-id',
      permission_role_id: 'role-id',
    });
  });

  it('stores null description when omitted', async () => {
    const returning = jest.fn(async () => [{ permission_role_id: 'role-id' }]);
    const roleValues = jest.fn(() => ({ returning }));
    const insert = jest.fn(() => ({ values: roleValues }));
    const limit = jest.fn(async () => []);
    const where = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where }));
    const select = jest.fn(() => ({ from }));
    const transaction = jest.fn(async (callback) =>
      callback({ insert, select })
    );
    const repository = new RoleCreatorRepository({ transaction } as never);

    await repository.createRole('Admin', 'acc-1', undefined);

    expect(roleValues).toHaveBeenCalledWith(
      expect.objectContaining({
        description: null,
      })
    );
  });

  it('returns null when returning has no rows', async () => {
    const returning = jest.fn(async () => []);
    const roleValues = jest.fn(() => ({ returning }));
    const insert = jest.fn(() => ({ values: roleValues }));
    const transaction = jest.fn(async (callback) => callback({ insert }));
    const repository = new RoleCreatorRepository({ transaction } as never);

    await expect(
      repository.createRole('Admin', 'acc-1', null)
    ).resolves.toBeNull();
  });
});
