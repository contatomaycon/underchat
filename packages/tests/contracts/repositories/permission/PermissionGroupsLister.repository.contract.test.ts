import 'reflect-metadata';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { PermissionGroupsListerRepository } from '@core/repositories/permission/PermissionGroupsLister.repository';

describe('PermissionGroupsListerRepository', () => {
  it('returns empty array when query has no rows', async () => {
    const execute = jest.fn(async () => ({ rowCount: 0, rows: [] }));
    const repository = new PermissionGroupsListerRepository({
      execute,
    } as never);

    await expect(
      repository.listPermissionGroupsByPermissionRoleId(
        'role-1',
        ERouteModule.web
      )
    ).resolves.toEqual([]);
  });

  it('groups SQL rows by action group and maps permissions', async () => {
    const rows = [
      {
        permission_action_group_id: 'group-1',
        group_name: 'Group A',
        group_description: 'Description',
        group_action: 'group_a',
        group_created_at: '2026-04-21T00:00:00.000Z',
        group_updated_at: '2026-04-21T00:00:00.000Z',
        group_selected: true,
        permission_action_id: 'perm-1',
        action: 'read',
        name: 'Read',
        description: 'Can read',
        created_at: '2026-04-21T00:00:00.000Z',
        updated_at: '2026-04-21T00:00:00.000Z',
      },
      {
        permission_action_group_id: 'group-1',
        group_name: 'Group A',
        group_description: 'Description',
        group_action: 'group_a',
        group_created_at: '2026-04-21T00:00:00.000Z',
        group_updated_at: '2026-04-21T00:00:00.000Z',
        group_selected: true,
        permission_action_id: null,
        action: null,
        name: null,
        description: null,
        created_at: null,
        updated_at: null,
      },
    ];

    const execute = jest.fn(async () => ({ rowCount: 2, rows }));
    const repository = new PermissionGroupsListerRepository({
      execute,
    } as never);

    await expect(
      repository.listPermissionGroupsByPermissionRoleId(
        'role-1',
        ERouteModule.web
      )
    ).resolves.toEqual([
      {
        permission_action_group_id: 'group-1',
        name: 'Group A',
        description: 'Description',
        action: 'group_a',
        created_at: '2026-04-21T00:00:00.000Z',
        updated_at: '2026-04-21T00:00:00.000Z',
        selected: true,
        permissions: [
          {
            permission_action_id: 'perm-1',
            action: 'read',
            name: 'Read',
            description: 'Can read',
            created_at: '2026-04-21T00:00:00.000Z',
            updated_at: '2026-04-21T00:00:00.000Z',
          },
        ],
      },
    ]);
  });
});
