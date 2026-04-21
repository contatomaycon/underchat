import 'reflect-metadata';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { MiddlewareJwtRepository } from '@core/repositories/middleware/MiddlewareJwt.repository';

describe('MiddlewareJwtRepository', () => {
  it('maps permissions and sets plan_is_active true when any row is active', async () => {
    const rows = [
      {
        account_id: 'acc-1',
        permission_role_id: 'role-1',
        role_name: 'Admin',
        module_name: 'chat',
        action_name: 'view',
        plan_is_active: false,
      },
      {
        account_id: 'acc-1',
        permission_role_id: 'role-1',
        role_name: 'Admin',
        module_name: 'chat',
        action_name: 'edit',
        plan_is_active: true,
      },
    ];

    const execute = jest.fn(async () => ({ rows }));
    const repository = new MiddlewareJwtRepository({ execute } as never);

    const result = await repository.find('user-1', 'chat', ERouteModule.web);

    expect(result.plan_is_active).toBe(true);
    expect(result.actions).toEqual([
      {
        account_id: 'acc-1',
        permission_role_id: 'role-1',
        role_name: 'Admin',
        module_name: 'chat',
        action_name: 'view',
      },
      {
        account_id: 'acc-1',
        permission_role_id: 'role-1',
        role_name: 'Admin',
        module_name: 'chat',
        action_name: 'edit',
      },
    ]);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("'user-1'"));
  });

  it('returns empty actions and plan_is_active false when no rows are returned', async () => {
    const execute = jest.fn(async () => ({ rows: [] }));
    const repository = new MiddlewareJwtRepository({ execute } as never);

    await expect(
      repository.find('user-1', 'chat', ERouteModule.web)
    ).resolves.toEqual({
      actions: [],
      plan_is_active: false,
    });
  });
});
