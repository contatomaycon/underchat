import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
import { RoleService } from '@core/services/role.service';

describe('RoleService', () => {
  it('delegates list and crud methods', async () => {
    const listRoles = jest.fn(async () => [{ role_id: 'r1' }]);
    const listRolesTotal = jest.fn(async () => 4);

    const service = new RoleService(
      { listRoles, listRolesTotal } as never,
      { existsRoleById: jest.fn(async () => true) } as never,
      { viewRoleById: jest.fn(async () => ({ role_id: 'r1' })) } as never,
      { deleteRoleById: jest.fn(async () => true) } as never,
      { updateRoleById: jest.fn(async () => 'r1') } as never,
      { existsRoleByName: jest.fn(async () => false) } as never,
      { createRole: jest.fn(async () => ({ role_id: 'r2' })) } as never,
      { totalRoleByAccount: jest.fn(async () => 7) } as never
    );

    await expect(
      service.listRoles(10, 1, { query: 'x' } as never, 'a1')
    ).resolves.toEqual([[{ role_id: 'r1' }], 4]);
    await expect(service.existsRoleById('r1', 'a1')).resolves.toBe(true);
    await expect(service.existsRoleByName('admin', 'a1')).resolves.toBe(false);
    await expect(service.viewRoleById('r1', 'a1')).resolves.toEqual({
      role_id: 'r1',
    });
    await expect(service.deleteRoleById('r1', 'a1')).resolves.toBe(true);
    await expect(
      service.updateRoleById('r1', 'admin', 'a1', 'desc')
    ).resolves.toBe('r1');
    await expect(service.createRole('operator', 'a1', null)).resolves.toEqual({
      role_id: 'r2',
    });
    await expect(service.totalRoleByAccount('a1')).resolves.toBe(7);
  });
});
