import 'reflect-metadata';

jest.mock('@core/services/permission.service', () => ({
  PermissionService: class {},
}));

import { RolePermissionsUpdaterUseCase } from '@core/useCases/permission/RolePermissionsUpdater.useCase';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

describe('RolePermissionsUpdaterUseCase', () => {
  it('throws when trying to edit own role', async () => {
    const service = {
      existsPermissionRoleById: jest.fn(),
      updateRolePermissions: jest.fn(),
    };
    const useCase = new RolePermissionsUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        'pr-1',
        [] as never,
        'acc-1',
        'pr-1',
        [] as never
      )
    ).rejects.toThrow('cannot_edit_own_role');

    expect(service.existsPermissionRoleById).not.toHaveBeenCalled();
  });

  it('throws when target permission role does not exist', async () => {
    const service = {
      existsPermissionRoleById: jest.fn(async () => false),
      updateRolePermissions: jest.fn(),
    };
    const useCase = new RolePermissionsUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        'pr-target',
        [] as never,
        'acc-1',
        'pr-current',
        [] as never
      )
    ).rejects.toThrow('permission_role_not_found');

    expect(service.updateRolePermissions).not.toHaveBeenCalled();
  });

  it('throws when no selected permission remains after filtering', async () => {
    const service = {
      existsPermissionRoleById: jest.fn(async () => true),
      updateRolePermissions: jest.fn(),
    };
    const useCase = new RolePermissionsUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        'pr-target',
        [
          {
            action: 'group.view',
            selected: true,
            permissions: [{ action: 'permission.view', selected: true }],
          },
        ] as never,
        'acc-1',
        'pr-current',
        [] as never
      )
    ).rejects.toThrow('role_permissions_required');

    expect(service.updateRolePermissions).not.toHaveBeenCalled();
  });

  it('updates permissions with filtered groups when requester has access', async () => {
    const service = {
      existsPermissionRoleById: jest.fn(async () => true),
      updateRolePermissions: jest.fn(async () => undefined),
    };
    const useCase = new RolePermissionsUpdaterUseCase(service as never);

    const groups = [
      {
        action: 'group.manage',
        selected: true,
        permissions: [
          { action: 'perm.allowed', selected: true },
          { action: 'perm.denied', selected: true },
        ],
      },
    ];

    const userActions = [{ action_name: 'perm.allowed' }];

    await expect(
      useCase.execute(
        jest.fn() as never,
        'pr-target',
        groups as never,
        'acc-1',
        'pr-current',
        userActions as never
      )
    ).resolves.toBeUndefined();

    expect(service.updateRolePermissions).toHaveBeenCalledWith('pr-target', [
      {
        action: 'group.manage',
        selected: false,
        permissions: [{ action: 'perm.allowed', selected: true }],
      },
    ]);
  });

  it('keeps group selected when requester has explicit group permission', async () => {
    const service = {
      existsPermissionRoleById: jest.fn(async () => true),
      updateRolePermissions: jest.fn(async () => undefined),
    };
    const useCase = new RolePermissionsUpdaterUseCase(service as never);

    await expect(
      useCase.execute(
        jest.fn() as never,
        'pr-target',
        [
          {
            action: 'group.manage',
            selected: true,
            permissions: [
              { action: 'perm.allowed', selected: true },
              { action: 'perm.denied', selected: false },
            ],
          },
        ] as never,
        'acc-1',
        'pr-current',
        [
          { action_name: 'group.manage' },
          { action_name: 'perm.allowed' },
        ] as never
      )
    ).resolves.toBeUndefined();

    expect(service.updateRolePermissions).toHaveBeenCalledWith('pr-target', [
      {
        action: 'group.manage',
        selected: true,
        permissions: [{ action: 'perm.allowed', selected: true }],
      },
    ]);
  });

  it('grants all filtered permissions when requester has full access', async () => {
    const service = {
      existsPermissionRoleById: jest.fn(async () => true),
      updateRolePermissions: jest.fn(async () => undefined),
    };
    const useCase = new RolePermissionsUpdaterUseCase(service as never);

    await expect(
      useCase.execute(
        jest.fn() as never,
        'pr-target',
        [
          {
            action: 'group.manage',
            selected: true,
            permissions: [
              { action: 'perm.allowed', selected: true },
              { action: 'perm.denied', selected: false },
            ],
          },
        ] as never,
        'acc-1',
        'pr-current',
        [{ action_name: EGeneralPermissions.full_access }] as never
      )
    ).resolves.toBeUndefined();

    expect(service.updateRolePermissions).toHaveBeenCalledWith('pr-target', [
      {
        action: 'group.manage',
        selected: true,
        permissions: [
          { action: 'perm.allowed', selected: true },
          { action: 'perm.denied', selected: false },
        ],
      },
    ]);
  });
});
