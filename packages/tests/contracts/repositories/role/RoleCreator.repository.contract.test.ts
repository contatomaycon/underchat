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
    const values = jest.fn(() => ({ returning }));
    const insert = jest.fn(() => ({ values }));
    const repository = new RoleCreatorRepository({ insert } as never);

    await expect(
      repository.createRole('Admin', 'acc-1', 'Descrição')
    ).resolves.toEqual({ permission_role_id: 'role-id' });

    expect(values).toHaveBeenCalledWith({
      permission_role_id: 'role-id',
      account_id: 'acc-1',
      name: 'Admin',
      description: 'Descrição',
    });
  });

  it('stores null description when omitted', async () => {
    const returning = jest.fn(async () => [{ permission_role_id: 'role-id' }]);
    const values = jest.fn(() => ({ returning }));
    const insert = jest.fn(() => ({ values }));
    const repository = new RoleCreatorRepository({ insert } as never);

    await repository.createRole('Admin', 'acc-1', undefined);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        description: null,
      })
    );
  });

  it('returns null when returning has no rows', async () => {
    const returning = jest.fn(async () => []);
    const values = jest.fn(() => ({ returning }));
    const insert = jest.fn(() => ({ values }));
    const repository = new RoleCreatorRepository({ insert } as never);

    await expect(
      repository.createRole('Admin', 'acc-1', null)
    ).resolves.toBeNull();
  });
});
