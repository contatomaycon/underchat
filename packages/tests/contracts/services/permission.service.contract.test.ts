import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
import { PermissionService } from '@core/services/permission.service';

describe('PermissionService', () => {
  it('maps actions and delegates remaining methods', async () => {
    const viewPermissionByUserId = jest.fn(async () => [
      { action: 'chat.view' },
      { action: 'chat.edit' },
    ]);

    const service = new PermissionService(
      { viewPermissionByUserId } as never,
      { existsPermissionRoleById: jest.fn(async () => true) } as never,
      {
        listPermissionRoleAccountById: jest.fn(async () => [{ role: 'admin' }]),
      } as never,
      { getPermissionRoleAccountId: jest.fn(async () => 'a1') } as never,
      {
        listPermissionGroupsByPermissionRoleId: jest.fn(async () => [
          { id: 'g1' },
        ]),
      } as never,
      { updateRolePermissions: jest.fn(async () => undefined) } as never
    );

    await expect(service.viewPermissionByUserId('u1')).resolves.toEqual([
      'chat.view',
      'chat.edit',
    ]);
    await expect(service.existsPermissionRoleById('a1', 'r1')).resolves.toBe(
      true
    );
    await expect(service.listPermissionRoleAccountById('a1')).resolves.toEqual([
      { role: 'admin' },
    ]);
    await expect(
      service.listPermissionGroupsByPermissionRoleId('r1', 'dashboard' as never)
    ).resolves.toEqual([{ id: 'g1' }]);
    await expect(
      service.updateRolePermissions('r1', [{ group_id: 'g1' }] as never)
    ).resolves.toBeUndefined();
    await expect(service.getPermissionRoleAccountId('r1')).resolves.toBe('a1');
  });
});
