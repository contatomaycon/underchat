import 'reflect-metadata';

jest.mock('@core/services/role.service', () => ({
  RoleService: class {},
}));

import { RoleUpdaterUseCase } from '@core/useCases/role/RoleUpdater.useCase';

describe('RoleUpdaterUseCase', () => {
  it('throws when role does not exist', async () => {
    const service = {
      existsRoleById: jest.fn(async () => false),
      updateRoleById: jest.fn(),
    };
    const useCase = new RoleUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'role-1', 'Admin', 'acc-1', null)
    ).rejects.toThrow('role_not_found');
    expect(service.updateRoleById).not.toHaveBeenCalled();
  });

  it('throws when update fails', async () => {
    const service = {
      existsRoleById: jest.fn(async () => true),
      updateRoleById: jest.fn(async () => false),
    };
    const useCase = new RoleUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'role-1', 'Admin', 'acc-1', 'desc')
    ).rejects.toThrow('role_update_error');
  });

  it('returns true when update succeeds', async () => {
    const service = {
      existsRoleById: jest.fn(async () => true),
      updateRoleById: jest.fn(async () => true),
    };
    const useCase = new RoleUpdaterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'role-1', 'Admin', 'acc-1', 'desc')
    ).resolves.toBe(true);

    expect(service.updateRoleById).toHaveBeenCalledWith(
      'role-1',
      'Admin',
      'acc-1',
      'desc'
    );
  });
});
