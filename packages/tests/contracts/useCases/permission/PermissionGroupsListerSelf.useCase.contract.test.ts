import 'reflect-metadata';

jest.mock('@core/services/permission.service', () => ({
  PermissionService: class {},
}));

import { PermissionGroupsListerSelfUseCase } from '@core/useCases/permission/PermissionGroupsListerSelf.useCase';
import { ERouteModule } from '@core/common/enums/ERouteModule';

describe('PermissionGroupsListerSelfUseCase', () => {
  it('delegates permission groups listing for own role', async () => {
    const result = { groups: [] };
    const service = {
      listPermissionGroupsByPermissionRoleId: jest.fn(async () => result),
    };
    const useCase = new PermissionGroupsListerSelfUseCase(service as never);

    await expect(useCase.execute('pr-1')).resolves.toEqual(result);
    expect(service.listPermissionGroupsByPermissionRoleId).toHaveBeenCalledWith(
      'pr-1',
      ERouteModule.manager
    );
  });
});
