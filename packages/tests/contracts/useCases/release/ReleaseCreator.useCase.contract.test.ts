import 'reflect-metadata';

jest.mock('@core/services/release.service', () => ({
  ReleaseService: class {},
}));

import { ReleaseCreatorUseCase } from '@core/useCases/release/ReleaseCreator.useCase';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EReleaseType } from '@core/common/enums/EReleaseType';

describe('ReleaseCreatorUseCase', () => {
  it('throws when creating account release without full access', async () => {
    const service = { createRelease: jest.fn() };
    const useCase = new ReleaseCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        {
          account_id: 'target-acc',
          user_id: null,
          permission_role_id: null,
          type: EReleaseType.news,
        } as never,
        'acc-1',
        'user-1',
        [] as never
      )
    ).rejects.toThrow('release_create_account_permission_error');

    expect(service.createRelease).not.toHaveBeenCalled();
  });

  it('throws when reminder type has no reminder_at', async () => {
    const service = { createRelease: jest.fn() };
    const useCase = new ReleaseCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        {
          account_id: null,
          user_id: null,
          permission_role_id: null,
          type: EReleaseType.reminder,
          reminder_at: null,
        } as never,
        'acc-1',
        'user-1',
        [{ action_name: EGeneralPermissions.full_access }] as never
      )
    ).rejects.toThrow('release_reminder_datetime_required');
  });

  it('throws when release creation fails', async () => {
    const service = { createRelease: jest.fn(async () => '') };
    const useCase = new ReleaseCreatorUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        {
          account_id: null,
          user_id: null,
          permission_role_id: null,
          type: EReleaseType.news,
        } as never,
        'acc-1',
        'user-1',
        [{ action_name: EGeneralPermissions.full_access_group }] as never
      )
    ).rejects.toThrow('release_create_error');
  });

  it('returns release id when creation succeeds', async () => {
    const input = {
      account_id: null,
      user_id: null,
      permission_role_id: null,
      type: EReleaseType.news,
    } as never;
    const service = { createRelease: jest.fn(async () => 'rel-1') };
    const useCase = new ReleaseCreatorUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, input, 'acc-1', 'user-1', [
        { action_name: EGeneralPermissions.full_access },
      ] as never)
    ).resolves.toBe('rel-1');

    expect(service.createRelease).toHaveBeenCalledWith(
      input,
      'acc-1',
      'acc-1',
      true,
      'user-1'
    );
  });

  it('allows non-account release without full access when account_id is undefined', async () => {
    const input = {
      account_id: undefined,
      user_id: null,
      permission_role_id: null,
      type: EReleaseType.news,
    } as never;
    const service = { createRelease: jest.fn(async () => 'rel-2') };
    const useCase = new ReleaseCreatorUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, input, 'acc-1', 'user-1', [] as never)
    ).resolves.toBe('rel-2');

    expect(service.createRelease).toHaveBeenCalledWith(
      input,
      'acc-1',
      'acc-1',
      false,
      'user-1'
    );
  });

  it('allows account release when requester has full access', async () => {
    const input = {
      account_id: 'target-acc',
      user_id: null,
      permission_role_id: null,
      type: EReleaseType.news,
    } as never;
    const service = { createRelease: jest.fn(async () => 'rel-3') };
    const useCase = new ReleaseCreatorUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, input, 'acc-1', 'user-1', [
        { action_name: EGeneralPermissions.full_access },
      ] as never)
    ).resolves.toBe('rel-3');

    expect(service.createRelease).toHaveBeenCalledWith(
      input,
      'acc-1',
      'acc-1',
      true,
      'user-1'
    );
  });

  it('supports undefined user and permission role fields for account release', async () => {
    const input = {
      account_id: 'target-acc',
      user_id: undefined,
      permission_role_id: undefined,
      type: EReleaseType.news,
    } as never;
    const service = { createRelease: jest.fn(async () => 'rel-4') };
    const useCase = new ReleaseCreatorUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, input, 'acc-1', 'user-1', [
        { action_name: EGeneralPermissions.full_access_group },
      ] as never)
    ).resolves.toBe('rel-4');
  });
});
