import 'reflect-metadata';

import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import { UserCreatorUseCase } from '@core/useCases/user/UserCreator.useCase';
import { UserRoleAssignerUseCase } from '@core/useCases/user/UserRoleAssigner.useCase';
import { UserUpdaterUseCase } from '@core/useCases/user/UserUpdater.useCase';

describe('protected user blocking guards', () => {
  const t = ((key: string) => key) as never;

  it.each([EPermissionRole.master, EPermissionRole.administrator])(
    'rejects status blocking for protected role %s',
    async (permissionRoleId) => {
      const userService = {
        existsUserById: jest.fn(async () => true),
        getUserRole: jest.fn(async () => permissionRoleId),
      };
      const useCase = new UserUpdaterUseCase(
        {} as never,
        {} as never,
        userService as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      );

      await expect(
        useCase.execute(
          t,
          'user-1',
          {
            user_status_id: { value: EUserStatus.blocked },
          } as never,
          'acc-1',
          false
        )
      ).rejects.toThrow('cannot_block_system_user');
    }
  );

  it.each([EPermissionRole.master, EPermissionRole.administrator])(
    'rejects creation of blocked protected role %s',
    async (permissionRoleId) => {
      const useCase = new UserCreatorUseCase(
        {
          existsUserEmailById: jest.fn(async () => false),
        } as never,
        {
          existsAccountById: jest.fn(async () => true),
        } as never,
        {} as never,
        {} as never,
        {} as never
      );

      await expect(
        useCase.validate(
          t,
          {
            email: { value: 'protected@example.com' },
            password: { value: 'ValidPassword1!' },
            name: { value: 'Protected' },
            last_name: { value: 'User' },
            permission_role_id: { value: permissionRoleId },
            user_status_id: { value: EUserStatus.blocked },
          } as never,
          'acc-1'
        )
      ).rejects.toThrow('cannot_block_system_user');
    }
  );

  it.each([EPermissionRole.master, EPermissionRole.administrator])(
    'reactivates a blocked user assigned to protected role %s',
    async (permissionRoleId) => {
      const userService = {
        existsUserById: jest.fn(async () => true),
        getUserRole: jest.fn(async () => 'custom-role'),
        assignUserRole: jest.fn(async () => true),
      };
      const planLimitEnforcementService = {
        activateProtectedUserIfBlocked: jest.fn(async () => true),
      };
      const useCase = new UserRoleAssignerUseCase(
        userService as never,
        {
          existsPermissionRoleById: jest.fn(async () => true),
        } as never,
        planLimitEnforcementService as never
      );

      await expect(
        useCase.execute(
          t,
          'user-1',
          'acc-1',
          { permission_role_id: permissionRoleId },
          false
        )
      ).resolves.toBe(true);

      expect(
        planLimitEnforcementService.activateProtectedUserIfBlocked
      ).toHaveBeenCalledWith('acc-1', 'user-1');
    }
  );
});
