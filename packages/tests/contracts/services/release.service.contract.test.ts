import 'reflect-metadata';

jest.mock('@core/repositories/user/UserViewer.repository', () => ({
  UserViewerRepository: class {},
}));

jest.mock('@core/repositories/release/ReleaseLister.repository', () => ({
  ReleaseListerRepository: class {},
}));

jest.mock('@core/repositories/release/ReleaseViewer.repository', () => ({
  ReleaseViewerRepository: class {},
}));

jest.mock('@core/repositories/release/ReleaseViewViewer.repository', () => ({
  ReleaseViewViewerRepository: class {},
}));

jest.mock('@core/repositories/release/ReleaseViewCreator.repository', () => ({
  ReleaseViewCreatorRepository: class {},
}));

jest.mock('@core/repositories/release/ReleaseCreator.repository', () => ({
  ReleaseCreatorRepository: class {},
}));

jest.mock('@core/repositories/release/ReleaseDeleter.repository', () => ({
  ReleaseDeleterRepository: class {},
}));

jest.mock('@core/repositories/release/ReleaseUpdater.repository', () => ({
  ReleaseUpdaterRepository: class {},
}));

jest.mock('@core/repositories/release/ReleaseUsersLister.repository', () => ({
  ReleaseUsersListerRepository: class {},
}));

jest.mock(
  '@core/repositories/release/ReleaseAccountsLister.repository',
  () => ({
    ReleaseAccountsListerRepository: class {},
  })
);

jest.mock(
  '@core/repositories/release/ReleasePermissionRolesLister.repository',
  () => ({
    ReleasePermissionRolesListerRepository: class {},
  })
);

import { ReleaseService } from '@core/services/release.service';

describe('ReleaseService', () => {
  const createdAt = '2026-01-10T10:00:00.000Z';

  const makeService = () => {
    const userViewerRepository = {
      getCreatedAtByUserId: jest.fn(async () => createdAt),
    };

    const releaseListerRepository = {
      listReleases: jest.fn(async () => [
        {
          release_id: 'rel-1',
          title: 'Release 1',
        },
      ]),
      listReleasesTotal: jest.fn(async () => 1),
      countUnreadReleases: jest.fn(async () => 2),
    };

    const releaseViewerRepository = {
      viewRelease: jest.fn<Promise<any>, any[]>(async () => ({
        release_id: 'rel-1',
        title: 'Release 1',
      })),
    };

    const releaseViewViewerRepository = {
      existsReleaseView: jest.fn(async () => true),
    };

    const releaseViewCreatorRepository = {
      createReleaseView: jest.fn(async () => true),
    };

    const releaseCreatorRepository = {
      createRelease: jest.fn(async () => 'rel-1'),
    };

    const releaseDeleterRepository = {
      deleteById: jest.fn<Promise<true | 'not_found' | 'forbidden'>, any[]>(
        async () => true
      ),
    };

    const releaseUpdaterRepository = {
      updateById: jest.fn<
        Promise<true | 'not_found' | 'forbidden' | 'invalid_reminder'>,
        any[]
      >(async () => true),
    };

    const releaseUsersListerRepository = {
      listReleaseUsers: jest.fn(async () => ({ users: [] })),
    };

    const releaseAccountsListerRepository = {
      listReleaseAccounts: jest.fn(async () => ({ accounts: [] })),
    };

    const releasePermissionRolesListerRepository = {
      listReleasePermissionRoles: jest.fn(async () => ({ roles: [] })),
    };

    const service = new ReleaseService(
      userViewerRepository as never,
      releaseListerRepository as never,
      releaseViewerRepository as never,
      releaseViewViewerRepository as never,
      releaseViewCreatorRepository as never,
      releaseCreatorRepository as never,
      releaseDeleterRepository as never,
      releaseUpdaterRepository as never,
      releaseUsersListerRepository as never,
      releaseAccountsListerRepository as never,
      releasePermissionRolesListerRepository as never
    );

    return {
      service,
      userViewerRepository,
      releaseListerRepository,
      releaseViewerRepository,
      releaseViewViewerRepository,
      releaseViewCreatorRepository,
      releaseCreatorRepository,
      releaseDeleterRepository,
      releaseUpdaterRepository,
      releaseUsersListerRepository,
      releaseAccountsListerRepository,
      releasePermissionRolesListerRepository,
    };
  };

  it('lists releases with user creation date context', async () => {
    const { service, userViewerRepository, releaseListerRepository } =
      makeService();

    await expect(
      service.listReleases(
        10,
        1,
        { search: 'release', status: 'active' } as never,
        'acc-1',
        'user-1',
        'perm-1'
      )
    ).resolves.toEqual([
      [
        {
          release_id: 'rel-1',
          title: 'Release 1',
        },
      ],
      1,
    ]);

    expect(userViewerRepository.getCreatedAtByUserId).toHaveBeenCalledWith(
      'user-1'
    );
    expect(releaseListerRepository.listReleases).toHaveBeenCalledWith(
      10,
      1,
      { search: 'release', status: 'active' },
      'acc-1',
      'user-1',
      'perm-1',
      createdAt
    );
    expect(releaseListerRepository.listReleasesTotal).toHaveBeenCalledWith(
      { search: 'release', status: 'active' },
      'acc-1',
      'user-1',
      'perm-1',
      createdAt
    );
  });

  it('returns null when release is not found', async () => {
    const {
      service,
      releaseViewerRepository,
      releaseViewViewerRepository,
      releaseViewCreatorRepository,
    } = makeService();

    releaseViewerRepository.viewRelease.mockResolvedValueOnce(null);

    await expect(
      service.viewRelease('rel-x', 'acc-1', 'user-1', 'perm-1')
    ).resolves.toBeNull();

    expect(releaseViewerRepository.viewRelease).toHaveBeenCalledTimes(1);
    expect(
      releaseViewViewerRepository.existsReleaseView
    ).not.toHaveBeenCalled();
    expect(
      releaseViewCreatorRepository.createReleaseView
    ).not.toHaveBeenCalled();
  });

  it('creates release view when missing and returns refreshed release', async () => {
    const {
      service,
      releaseViewerRepository,
      releaseViewViewerRepository,
      releaseViewCreatorRepository,
    } = makeService();

    releaseViewerRepository.viewRelease
      .mockResolvedValueOnce({ release_id: 'rel-1', title: 'Before view' })
      .mockResolvedValueOnce({ release_id: 'rel-1', title: 'After view' });
    releaseViewViewerRepository.existsReleaseView.mockResolvedValueOnce(false);

    await expect(
      service.viewRelease('rel-1', 'acc-1', 'user-1', 'perm-1')
    ).resolves.toEqual({
      release_id: 'rel-1',
      title: 'After view',
    });

    expect(releaseViewViewerRepository.existsReleaseView).toHaveBeenCalledWith(
      'rel-1',
      'user-1'
    );
    expect(releaseViewCreatorRepository.createReleaseView).toHaveBeenCalledWith(
      'rel-1',
      'user-1'
    );
    expect(releaseViewerRepository.viewRelease).toHaveBeenCalledTimes(2);
  });

  it('does not create release view when view already exists', async () => {
    const {
      service,
      releaseViewerRepository,
      releaseViewViewerRepository,
      releaseViewCreatorRepository,
    } = makeService();

    releaseViewerRepository.viewRelease
      .mockResolvedValueOnce({ release_id: 'rel-1', title: 'Before view' })
      .mockResolvedValueOnce({ release_id: 'rel-1', title: 'After view' });
    releaseViewViewerRepository.existsReleaseView.mockResolvedValueOnce(true);

    await expect(
      service.viewRelease('rel-1', 'acc-1', 'user-1', 'perm-1')
    ).resolves.toEqual({
      release_id: 'rel-1',
      title: 'After view',
    });

    expect(
      releaseViewCreatorRepository.createReleaseView
    ).not.toHaveBeenCalled();
  });

  it('delegates delete, update and create operations to repositories', async () => {
    const {
      service,
      releaseDeleterRepository,
      releaseUpdaterRepository,
      releaseCreatorRepository,
    } = makeService();

    releaseDeleterRepository.deleteById.mockResolvedValueOnce('forbidden');
    releaseUpdaterRepository.updateById.mockResolvedValueOnce(
      'invalid_reminder'
    );

    await expect(service.deleteRelease('rel-1', 'user-1')).resolves.toBe(
      'forbidden'
    );
    expect(releaseDeleterRepository.deleteById).toHaveBeenCalledWith(
      'rel-1',
      'user-1'
    );

    await expect(
      service.updateRelease('rel-1', 'user-1', {
        title: 'New title',
      } as never)
    ).resolves.toBe('invalid_reminder');
    expect(releaseUpdaterRepository.updateById).toHaveBeenCalledWith(
      'rel-1',
      'user-1',
      {
        title: 'New title',
      }
    );

    await expect(
      service.createRelease(
        { title: 'New release' } as never,
        'acc-1',
        'acc-user-1',
        false,
        'user-1'
      )
    ).resolves.toBe('rel-1');

    expect(releaseCreatorRepository.createRelease).toHaveBeenCalledWith(
      {
        title: 'New release',
      },
      'acc-1',
      'acc-user-1',
      false,
      'user-1'
    );
  });

  it('delegates user/account/permission-role listing', async () => {
    const {
      service,
      releaseUsersListerRepository,
      releaseAccountsListerRepository,
      releasePermissionRolesListerRepository,
    } = makeService();

    await expect(service.listReleaseUsers('acc-1')).resolves.toEqual({
      users: [],
    });
    expect(releaseUsersListerRepository.listReleaseUsers).toHaveBeenCalledWith(
      'acc-1'
    );

    await expect(service.listReleaseAccounts()).resolves.toEqual({
      accounts: [],
    });
    expect(
      releaseAccountsListerRepository.listReleaseAccounts
    ).toHaveBeenCalledWith();

    await expect(service.listReleasePermissionRoles('acc-1')).resolves.toEqual({
      roles: [],
    });
    expect(
      releasePermissionRolesListerRepository.listReleasePermissionRoles
    ).toHaveBeenCalledWith('acc-1');
  });

  it('lists notifications using unread count and fixed pagination feed query', async () => {
    const { service, releaseListerRepository, userViewerRepository } =
      makeService();

    releaseListerRepository.listReleases.mockResolvedValueOnce([
      {
        release_id: 'rel-1',
        title: 'Release 1',
      },
    ]);
    releaseListerRepository.countUnreadReleases.mockResolvedValueOnce(9);

    await expect(
      service.listReleaseNotifications('acc-1', 'user-1', 'perm-1')
    ).resolves.toEqual({
      unread_count: 9,
      results: [
        {
          release_id: 'rel-1',
          title: 'Release 1',
        },
      ],
    });

    expect(userViewerRepository.getCreatedAtByUserId).toHaveBeenCalledWith(
      'user-1'
    );
    expect(releaseListerRepository.countUnreadReleases).toHaveBeenCalledWith(
      'acc-1',
      'user-1',
      'perm-1',
      createdAt,
      true
    );
    expect(releaseListerRepository.listReleases).toHaveBeenCalledWith(
      4,
      1,
      {
        current_page: 1,
        per_page: 4,
      },
      'acc-1',
      'user-1',
      'perm-1',
      createdAt,
      true
    );
  });
});
