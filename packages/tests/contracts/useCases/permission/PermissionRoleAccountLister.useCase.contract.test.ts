import 'reflect-metadata';

jest.mock('@core/services/permission.service', () => ({
  PermissionService: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { PermissionRoleAccountListerUseCase } from '@core/useCases/permission/PermissionRoleAccountLister.useCase';

describe('PermissionRoleAccountListerUseCase', () => {
  it('throws when account does not exist', async () => {
    const permissionService = {
      listPermissionRoleAccountById: jest.fn(),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => false),
    };
    const useCase = new PermissionRoleAccountListerUseCase(
      permissionService as never,
      accountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(
      permissionService.listPermissionRoleAccountById
    ).not.toHaveBeenCalled();
  });

  it('returns roles when account exists', async () => {
    const roles = [{ permission_role_id: 'pr-1' }];
    const permissionService = {
      listPermissionRoleAccountById: jest.fn(async () => roles),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const useCase = new PermissionRoleAccountListerUseCase(
      permissionService as never,
      accountService as never
    );

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toEqual(
      roles
    );
  });
});
