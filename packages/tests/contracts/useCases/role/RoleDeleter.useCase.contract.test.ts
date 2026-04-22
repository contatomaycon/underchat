import 'reflect-metadata';

jest.mock('@core/services/role.service', () => ({
  RoleService: class {},
}));

import { RoleDeleterUseCase } from '@core/useCases/role/RoleDeleter.useCase';

describe('RoleDeleterUseCase', () => {
  it('throws when role does not exist', async () => {
    const service = {
      existsRoleById: jest.fn(async () => false),
      deleteRoleById: jest.fn(),
    };
    const useCase = new RoleDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'role-1', 'acc-1')
    ).rejects.toThrow('role_not_found');
    expect(service.deleteRoleById).not.toHaveBeenCalled();
  });

  it('throws when role deletion fails', async () => {
    const service = {
      existsRoleById: jest.fn(async () => true),
      deleteRoleById: jest.fn(async () => false),
    };
    const useCase = new RoleDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'role-1', 'acc-1')
    ).rejects.toThrow('role_deleter_error');
  });

  it('returns true when deletion succeeds', async () => {
    const service = {
      existsRoleById: jest.fn(async () => true),
      deleteRoleById: jest.fn(async () => true),
    };
    const useCase = new RoleDeleterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'role-1', 'acc-1')
    ).resolves.toBe(true);
    expect(service.deleteRoleById).toHaveBeenCalledWith('role-1', 'acc-1');
  });
});
