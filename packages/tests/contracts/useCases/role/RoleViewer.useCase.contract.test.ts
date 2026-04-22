import 'reflect-metadata';

jest.mock('@core/services/role.service', () => ({
  RoleService: class {},
}));

import { RoleViewerUseCase } from '@core/useCases/role/RoleViewer.useCase';

describe('RoleViewerUseCase', () => {
  it('throws when role does not exist', async () => {
    const service = {
      existsRoleById: jest.fn(async () => false),
      viewRoleById: jest.fn(),
    };
    const useCase = new RoleViewerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'role-1', 'acc-1')
    ).rejects.toThrow('role_not_found');
    expect(service.viewRoleById).not.toHaveBeenCalled();
  });

  it('returns role data when role exists', async () => {
    const role = { role_id: 'role-1' };
    const service = {
      existsRoleById: jest.fn(async () => true),
      viewRoleById: jest.fn(async () => role),
    };
    const useCase = new RoleViewerUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'role-1', 'acc-1')
    ).resolves.toEqual(role);
    expect(service.viewRoleById).toHaveBeenCalledWith('role-1', 'acc-1');
  });
});
