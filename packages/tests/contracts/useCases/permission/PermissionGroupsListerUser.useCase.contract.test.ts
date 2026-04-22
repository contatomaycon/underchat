import 'reflect-metadata';

jest.mock('@core/services/permission.service', () => ({
  PermissionService: class {},
}));

import { PermissionGroupsListerUserUseCase } from '@core/useCases/permission/PermissionGroupsListerUser.useCase';
import { ERouteModule } from '@core/common/enums/ERouteModule';

describe('PermissionGroupsListerUserUseCase', () => {
  it('throws when permission role does not exist', async () => {
    const service = {
      existsPermissionRoleById: jest.fn(async () => false),
      listPermissionGroupsByPermissionRoleId: jest.fn(),
    };
    const useCase = new PermissionGroupsListerUserUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1', 'pr-1')).rejects.toThrow(
      'permission_role_not_found'
    );

    expect(
      service.listPermissionGroupsByPermissionRoleId
    ).not.toHaveBeenCalled();
  });

  it('returns groups when permission role exists', async () => {
    const result = { groups: [] };
    const service = {
      existsPermissionRoleById: jest.fn(async () => true),
      listPermissionGroupsByPermissionRoleId: jest.fn(async () => result),
    };
    const useCase = new PermissionGroupsListerUserUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', 'pr-1')
    ).resolves.toEqual(result);

    expect(service.listPermissionGroupsByPermissionRoleId).toHaveBeenCalledWith(
      'pr-1',
      ERouteModule.manager
    );
  });
});
