import { injectable, inject } from 'tsyringe';
import { UserViewerRepository } from '@core/repositories/user/UserViewer.repository';
import { ReleaseListerRepository } from '@core/repositories/release/ReleaseLister.repository';
import { ReleaseViewerRepository } from '@core/repositories/release/ReleaseViewer.repository';
import { ReleaseViewViewerRepository } from '@core/repositories/release/ReleaseViewViewer.repository';
import { ReleaseViewCreatorRepository } from '@core/repositories/release/ReleaseViewCreator.repository';
import { ReleaseCreatorRepository } from '@core/repositories/release/ReleaseCreator.repository';
import { ReleaseDeleterRepository } from '@core/repositories/release/ReleaseDeleter.repository';
import { ReleaseUpdaterRepository } from '@core/repositories/release/ReleaseUpdater.repository';
import { ReleaseUsersListerRepository } from '@core/repositories/release/ReleaseUsersLister.repository';
import { ReleaseAccountsListerRepository } from '@core/repositories/release/ReleaseAccountsLister.repository';
import { ReleasePermissionRolesListerRepository } from '@core/repositories/release/ReleasePermissionRolesLister.repository';
import { ListReleaseRequest } from '@core/schema/release/listRelease/request.schema';
import { ListReleaseResponse } from '@core/schema/release/listRelease/response.schema';
import { ViewReleaseResponse } from '@core/schema/release/viewRelease/response.schema';
import { CreateReleaseRequest } from '@core/schema/release/createRelease/request.schema';
import { EditReleaseBodyRequest } from '@core/schema/release/editRelease/request.schema';
import { ListReleaseUsersResponse } from '@core/schema/release/listReleaseUsers/response.schema';
import { ListReleaseAccountsResponse } from '@core/schema/release/listReleaseAccounts/response.schema';
import { ListReleasePermissionRolesResponse } from '@core/schema/release/listReleasePermissionRoles/response.schema';
import { ListReleaseNotificationsResponse } from '@core/schema/release/listReleaseNotifications/response.schema';

@injectable()
export class ReleaseService {
  constructor(
    @inject(UserViewerRepository)
    private readonly userViewerRepository: UserViewerRepository,
    @inject(ReleaseListerRepository)
    private readonly releaseListerRepository: ReleaseListerRepository,
    @inject(ReleaseViewerRepository)
    private readonly releaseViewerRepository: ReleaseViewerRepository,
    @inject(ReleaseViewViewerRepository)
    private readonly releaseViewViewerRepository: ReleaseViewViewerRepository,
    @inject(ReleaseViewCreatorRepository)
    private readonly releaseViewCreatorRepository: ReleaseViewCreatorRepository,
    @inject(ReleaseCreatorRepository)
    private readonly releaseCreatorRepository: ReleaseCreatorRepository,
    @inject(ReleaseDeleterRepository)
    private readonly releaseDeleterRepository: ReleaseDeleterRepository,
    @inject(ReleaseUpdaterRepository)
    private readonly releaseUpdaterRepository: ReleaseUpdaterRepository,
    @inject(ReleaseUsersListerRepository)
    private readonly releaseUsersListerRepository: ReleaseUsersListerRepository,
    @inject(ReleaseAccountsListerRepository)
    private readonly releaseAccountsListerRepository: ReleaseAccountsListerRepository,
    @inject(ReleasePermissionRolesListerRepository)
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
    const userCreatedAt =
      await this.userViewerRepository.getCreatedAtByUserId(userId);

    const [result, total] = await Promise.all([
      this.releaseListerRepository.listReleases(
        perPage,
        currentPage,
        query,
        accountId,
        userId,
        permissionRoleId,
        userCreatedAt
      ),
      this.releaseListerRepository.listReleasesTotal(
        query,
        accountId,
        userId,
        permissionRoleId,
        userCreatedAt
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
    const userCreatedAt =
      await this.userViewerRepository.getCreatedAtByUserId(userId);

    const release = await this.releaseViewerRepository.viewRelease(
      releaseId,
      accountId,
      userId,
      permissionRoleId,
      userCreatedAt
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
      permissionRoleId,
      userCreatedAt
    );

    return updatedRelease;
  };

  deleteRelease = async (
    releaseId: string,
    userId: string
  ): Promise<true | 'not_found' | 'forbidden'> => {
    return this.releaseDeleterRepository.deleteById(releaseId, userId);
  };

  updateRelease = async (
    releaseId: string,
    userId: string,
    input: EditReleaseBodyRequest
  ): Promise<true | 'not_found' | 'forbidden' | 'invalid_reminder'> => {
    return this.releaseUpdaterRepository.updateById(releaseId, userId, input);
  };

  createRelease = async (
    input: CreateReleaseRequest,
    accountId: string | null,
    userAccountId: string | null,
    hasFullAccess: boolean,
    createdByUserId: string
  ): Promise<string | null> => {
    return this.releaseCreatorRepository.createRelease(
      input,
      accountId,
      userAccountId,
      hasFullAccess,
      createdByUserId
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
    const userCreatedAt =
      await this.userViewerRepository.getCreatedAtByUserId(userId);
    const query = { current_page: 1, per_page: 4 };

    const reminderNotificationFeed = true;

    const [unreadCount, results] = await Promise.all([
      this.releaseListerRepository.countUnreadReleases(
        accountId,
        userId,
        permissionRoleId,
        userCreatedAt,
        reminderNotificationFeed
      ),
      this.releaseListerRepository.listReleases(
        4,
        1,
        query,
        accountId,
        userId,
        permissionRoleId,
        userCreatedAt,
        reminderNotificationFeed
      ),
    ]);

    return {
      unread_count: unreadCount,
      results,
    };
  };
}
