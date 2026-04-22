import 'reflect-metadata';

jest.mock('@core/services/role.service', () => ({
  RoleService: class {},
}));
jest.mock('@core/services/planAccount.service', () => ({
  PlanAccountService: class {},
}));

import { RoleCreatorUseCase } from '@core/useCases/role/RoleCreator.useCase';

describe('RoleCreatorUseCase', () => {
  it('throws when role already exists', async () => {
    const roleService = {
      existsRoleByName: jest.fn(async () => true),
      createRole: jest.fn(),
    };
    const planAccountService = {
      validateCanCreateRole: jest.fn(),
    };
    const useCase = new RoleCreatorUseCase(
      roleService as never,
      planAccountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'Admin', 'acc-1', null)
    ).rejects.toThrow('role_already_exists');
    expect(planAccountService.validateCanCreateRole).not.toHaveBeenCalled();
    expect(roleService.createRole).not.toHaveBeenCalled();
  });

  it('throws when role creation fails', async () => {
    const roleService = {
      existsRoleByName: jest.fn(async () => false),
      createRole: jest.fn(async () => null),
    };
    const planAccountService = {
      validateCanCreateRole: jest.fn(async () => undefined),
    };
    const useCase = new RoleCreatorUseCase(
      roleService as never,
      planAccountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'Admin', 'acc-1', 'desc')
    ).rejects.toThrow('role_creator_error');
  });

  it('returns created role when service succeeds', async () => {
    const created = { role_id: 'role-1' };
    const roleService = {
      existsRoleByName: jest.fn(async () => false),
      createRole: jest.fn(async () => created),
    };
    const planAccountService = {
      validateCanCreateRole: jest.fn(async () => undefined),
    };
    const useCase = new RoleCreatorUseCase(
      roleService as never,
      planAccountService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'Admin', 'acc-1', 'desc')
    ).resolves.toEqual(created);

    expect(planAccountService.validateCanCreateRole).toHaveBeenCalledWith(
      expect.any(Function),
      'acc-1'
    );
    expect(roleService.createRole).toHaveBeenCalledWith(
      'Admin',
      'acc-1',
      'desc'
    );
  });
});
