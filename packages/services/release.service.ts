import { injectable } from 'tsyringe';
import { ReleaseListerRepository } from '@core/repositories/release/ReleaseLister.repository';
import { ReleaseViewerRepository } from '@core/repositories/release/ReleaseViewer.repository';
import { ReleaseViewViewerRepository } from '@core/repositories/release/ReleaseViewViewer.repository';
import { ReleaseViewCreatorRepository } from '@core/repositories/release/ReleaseViewCreator.repository';
import { ReleaseCreatorRepository } from '@core/repositories/release/ReleaseCreator.repository';
import { ReleaseUsersListerRepository } from '@core/repositories/release/ReleaseUsersLister.repository';
import { ReleaseAccountsListerRepository } from '@core/repositories/release/ReleaseAccountsLister.repository';
import { ReleasePermissionRolesListerRepository } from '@core/repositories/release/ReleasePermissionRolesLister.repository';
import { ListReleaseRequest } from '@core/schema/release/listRelease/request.schema';
import { ListReleaseResponse } from '@core/schema/release/listRelease/response.schema';
import { ViewReleaseResponse } from '@core/schema/release/viewRelease/response.schema';
import { CreateReleaseRequest } from '@core/schema/release/createRelease/request.schema';
import { ListReleaseUsersResponse } from '@core/schema/release/listReleaseUsers/response.schema';
import { ListReleaseAccountsResponse } from '@core/schema/release/listReleaseAccounts/response.schema';
import { ListReleasePermissionRolesResponse } from '@core/schema/release/listReleasePermissionRoles/response.schema';
import { ListReleaseNotificationsResponse } from '@core/schema/release/listReleaseNotifications/response.schema';

@injectable()
export class ReleaseService {
  constructor(
    private readonly releaseListerRepository: ReleaseListerRepository,
    private readonly releaseViewerRepository: ReleaseViewerRepository,
    private readonly releaseViewViewerRepository: ReleaseViewViewerRepository,
    private readonly releaseViewCreatorRepository: ReleaseViewCreatorRepository,
    private readonly releaseCreatorRepository: ReleaseCreatorRepository,
    private readonly releaseUsersListerRepository: ReleaseUsersListerRepository,
    private readonly releaseAccountsListerRepository: ReleaseAccountsListerRepository,
    private readonly releasePermissionRolesListerRepository: ReleasePermissionRolesListerRepository
  ) {}

  listReleases = async (
    perPage: number,
    currentPage: number,
    query: ListReleaseRequest,
    accountId: string,
    userId: string,
    permissionRoleId: string
  ): Promise<[ListReleaseResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.releaseListerRepository.listReleases(
        perPage,
        currentPage,
        query,
        accountId,
        userId,
        permissionRoleId
      ),
      this.releaseListerRepository.listReleasesTotal(
        query,
        accountId,
        userId,
        permissionRoleId
      ),
    ]);

    return [result, total];
  };

  viewRelease = async (
    releaseId: string,
    accountId: string,
    userId: string,
    permissionRoleId: string
  ): Promise<ViewReleaseResponse | null> => {
    const release = await this.releaseViewerRepository.viewRelease(
      releaseId,
      accountId,
      userId,
      permissionRoleId
    );

    if (!release) {
      return null;
    }

    const existsView = await this.releaseViewViewerRepository.existsReleaseView(
      releaseId,
      userId
    );

    if (!existsView) {
      await this.releaseViewCreatorRepository.createReleaseView(
        releaseId,
        userId
      );
    }

    const updatedRelease = await this.releaseViewerRepository.viewRelease(
      releaseId,
      accountId,
      userId,
      permissionRoleId
    );

    return updatedRelease;
  };

  createRelease = async (
    input: CreateReleaseRequest,
    accountId: string | null,
    userAccountId: string | null,
    hasFullAccess: boolean
  ): Promise<string | null> => {
    return this.releaseCreatorRepository.createRelease(
      input,
      accountId,
      userAccountId,
      hasFullAccess
    );
  };

  listReleaseUsers = async (
    accountId: string
  ): Promise<ListReleaseUsersResponse> => {
    return this.releaseUsersListerRepository.listReleaseUsers(accountId);
  };

  listReleaseAccounts = async (): Promise<ListReleaseAccountsResponse> => {
    return this.releaseAccountsListerRepository.listReleaseAccounts();
  };

  listReleasePermissionRoles = async (
    accountId: string
  ): Promise<ListReleasePermissionRolesResponse> => {
    return this.releasePermissionRolesListerRepository.listReleasePermissionRoles(
      accountId
    );
  };

  listReleaseNotifications = async (
    accountId: string,
    userId: string,
    permissionRoleId: string
  ): Promise<ListReleaseNotificationsResponse> => {
    const query = { current_page: 1, per_page: 4 };

    const [unreadCount, results] = await Promise.all([
      this.releaseListerRepository.countUnreadReleases(
        accountId,
        userId,
        permissionRoleId
      ),
      this.releaseListerRepository.listReleases(
        4,
        1,
        query,
        accountId,
        userId,
        permissionRoleId
      ),
    ]);

    return {
      unread_count: unreadCount,
      results,
    };
  };
}
