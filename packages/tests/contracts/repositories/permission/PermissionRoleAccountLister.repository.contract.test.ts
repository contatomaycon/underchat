import 'reflect-metadata';
import { PermissionRoleAccountListerRepository } from '@core/repositories/permission/PermissionRoleAccountLister.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { dbRo: { select } };
}

describe('PermissionRoleAccountListerRepository', () => {
  it('returns empty array when no roles are found', async () => {
    const { dbRo } = createSelectChain([]);
    const repository = new PermissionRoleAccountListerRepository(dbRo as never);

    await expect(
      repository.listPermissionRoleAccountById('acc-1')
    ).resolves.toEqual([]);
  });

  it('returns roles when query returns rows', async () => {
    const rows = [{ id: 'role-1', name: 'Admin' }];
    const { dbRo } = createSelectChain(rows);
    const repository = new PermissionRoleAccountListerRepository(dbRo as never);

    await expect(
      repository.listPermissionRoleAccountById('acc-1')
    ).resolves.toEqual(rows);
  });
});
