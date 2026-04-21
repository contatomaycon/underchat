import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { RolePermissionsUpdaterRepository } from '@core/repositories/permission/RolePermissionsUpdater.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createRepository() {
  const tx = {
    delete: jest.fn(),
    insert: jest.fn(),
    select: jest.fn(),
  };
  const dbRw = {
    transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
      callback(tx)
    ),
  };

  return {
    repository: new RolePermissionsUpdaterRepository(dbRw as never),
    tx,
    dbRw,
  };
}

describe('RolePermissionsUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('role-action-id');
  });

  it('inserts only full_access_group when this group is selected', async () => {
    const { repository, tx } = createRepository();

    (repository as any).deleteAllRolePermissions = jest.fn(
      async () => undefined
    );
    (repository as any).findPermissionActionGroupIdByAction = jest.fn(
      async () => 'group-id'
    );
    (repository as any).insertRolePermissions = jest.fn(async () => undefined);

    await repository.updateRolePermissions('role-1', [
      {
        action: EGeneralPermissions.full_access_group,
        selected: true,
        permission_action_group_id: null,
        permissions: [],
      },
    ] as never);

    expect((repository as any).deleteAllRolePermissions).toHaveBeenCalledWith(
      tx,
      'role-1'
    );
    expect((repository as any).insertRolePermissions).toHaveBeenCalledWith(tx, [
      {
        permission_role_action_id: 'role-action-id',
        permission_role_id: 'role-1',
        permission_action_group_id: 'group-id',
      },
    ]);
  });

  it('inserts only full_access action when selected', async () => {
    const { repository, tx } = createRepository();

    (repository as any).deleteAllRolePermissions = jest.fn(
      async () => undefined
    );
    (repository as any).findPermissionActionIdByAction = jest.fn(
      async () => 'action-id'
    );
    (repository as any).insertRolePermissions = jest.fn(async () => undefined);

    await repository.updateRolePermissions('role-1', [
      {
        action: 'group-other',
        selected: false,
        permissions: [
          {
            action: EGeneralPermissions.full_access,
            selected: true,
            permission_action_id: null,
          },
        ],
      },
    ] as never);

    expect((repository as any).insertRolePermissions).toHaveBeenCalledWith(tx, [
      {
        permission_role_action_id: 'role-action-id',
        permission_role_id: 'role-1',
        permission_action_id: 'action-id',
      },
    ]);
  });

  it('inserts selected groups and selected individual permissions in regular flow', async () => {
    const { repository, tx } = createRepository();

    (repository as any).deleteAllRolePermissions = jest.fn(
      async () => undefined
    );
    (repository as any).findPermissionActionGroupIdByAction = jest
      .fn()
      .mockResolvedValueOnce('group-a-id');
    (repository as any).insertRolePermissions = jest.fn(async () => undefined);

    await repository.updateRolePermissions('role-1', [
      {
        action: EGeneralPermissions.full_access_group,
        selected: false,
        permissions: [],
      },
      {
        action: 'group_a',
        selected: true,
        permission_action_group_id: null,
        permissions: [],
      },
      {
        action: 'group_b',
        selected: false,
        permissions: [
          {
            action: 'read',
            selected: true,
            permission_action_id: 'perm-read',
          },
          {
            action: EGeneralPermissions.full_access,
            selected: false,
            permission_action_id: 'perm-full',
          },
        ],
      },
    ] as never);

    expect((repository as any).insertRolePermissions).toHaveBeenCalledWith(tx, [
      {
        permission_role_action_id: 'role-action-id',
        permission_role_id: 'role-1',
        permission_action_group_id: 'group-a-id',
      },
      {
        permission_role_action_id: 'role-action-id',
        permission_role_id: 'role-1',
        permission_action_id: 'perm-read',
      },
    ]);
  });
});
