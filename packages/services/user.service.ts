import { injectable } from 'tsyringe';
import { ListUserRequest } from '@core/schema/user/listUser/request.schema';
import { ListUserResponse } from '@core/schema/user/listUser/response.schema';
import { UserListerRepository } from '@core/repositories/user/UserLister.repository';
import { UserViewerExistsRepository } from '@core/repositories/user/UserViewerExists.repository';
import { UserDeleterRepository } from '@core/repositories/user/UserDeleter.repository';
import { UserViewerRepository } from '@core/repositories/user/UserViewer.repository';
import { ViewUserResponse } from '@core/schema/user/viewUser/response.schema';
import { UserStatusViewerExistsRepository } from '@core/repositories/user/UserStatusViewerExists.repository';
import { UserTransactionCreatorRepository } from '@core/repositories/user/UserCreatorTransaction.repository';
import { TFunction } from 'i18next';
import { CreateUserRequest } from '@core/schema/user/createUser/request.schema';
import { UserDocumentTypeViewerExistsRepository } from '@core/repositories/user/UserDocumentTypeViewerExists.repository';
import { UserUpdaterRepository } from '@core/repositories/user/UserUpdater.repository';
import { IUpdateUser } from '@core/common/interfaces/IUpdateUser';
import { UserInfoUpdaterRepository } from '@core/repositories/user/UserInfoUpdater.repository';
import { IUpdateUserInfo } from '@core/common/interfaces/IUpdateUserInfo';
import { UserDocumentUpdaterRepository } from '@core/repositories/user/UserDocumentUpdater.repository';
import { IUpdateUserDocument } from '@core/common/interfaces/IUpdateUserDocument';
import { UserAddressUpdaterRepository } from '@core/repositories/user/UserAddressUpdater.repository';
import { IUpdateUserAddress } from '@core/common/interfaces/IUpdateUserAddress';
import { UserNamePhotoViewerRepository } from '@core/repositories/user/UserNamePhotoViewer.repository';
import { IViewUserNamePhoto } from '@core/common/interfaces/IViewUserNamePhoto';

@injectable()
export class UserService {
  constructor(
    private readonly userListerRepository: UserListerRepository,
    private readonly userViewerExistsRepository: UserViewerExistsRepository,
    private readonly userDeleterRepository: UserDeleterRepository,
    private readonly userViewerRepository: UserViewerRepository,
    private readonly userStatusViewerExistsRepository: UserStatusViewerExistsRepository,
    private readonly userTransactionCreatorRepository: UserTransactionCreatorRepository,
    private readonly userDocumentTypeViewerExistsRepository: UserDocumentTypeViewerExistsRepository,
    private readonly userUpdaterRepository: UserUpdaterRepository,
    private readonly userInfoUpdaterRepository: UserInfoUpdaterRepository,
    private readonly userDocumentUpdaterRepository: UserDocumentUpdaterRepository,
    private readonly userAddressUpdaterRepository: UserAddressUpdaterRepository,
    private readonly userNamePhotoViewerRepository: UserNamePhotoViewerRepository
  ) {}

  listUsers = async (
    perPage: number,
    currentPage: number,
    query: ListUserRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<[ListUserResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.userListerRepository.listUsers(
        perPage,
        currentPage,
        query,
        accountId,
        isAdministrator
      ),
      this.userListerRepository.listUsersTotal(
        query,
        accountId,
        isAdministrator
      ),
    ]);

    return [result, total];
  };

  existsUserById = async (
    userId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    return this.userViewerExistsRepository.existsUserById(
      userId,
      accountId,
      isAdministrator
    );
  };

  deleteUserById = async (
    userId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> => {
    return this.userDeleterRepository.deleteUserById(
      userId,
      accountId,
      isAdministrator
    );
  };

  viewUserById = async (
    userId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ViewUserResponse | null> => {
    return this.userViewerRepository.viewUserById(
      userId,
      accountId,
      isAdministrator
    );
  };

  existsUserStatusById = async (userStatusId: string): Promise<boolean> => {
    return this.userStatusViewerExistsRepository.existsUserStatusById(
      userStatusId
    );
  };

  createUser = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateUserRequest
  ): Promise<boolean> => {
    return this.userTransactionCreatorRepository.createUser(
      t,
      accountId,
      input
    );
  };

  existsUserDocumentTypeById = async (
    userDocumentTypeId: string
  ): Promise<boolean> => {
    return this.userDocumentTypeViewerExistsRepository.existsUserDocumentTypeById(
      userDocumentTypeId
    );
  };

  updateUserById = async (
    userId: string,
    input: IUpdateUser,
    accountId: string
  ): Promise<boolean> => {
    return this.userUpdaterRepository.updateUserById(userId, input, accountId);
  };

  updateUserInfoById = async (
    userId: string,
    input: IUpdateUserInfo
  ): Promise<boolean> => {
    return this.userInfoUpdaterRepository.updateUserInfoById(userId, input);
  };

  updateUserDocumentById = async (
    userId: string,
    input: IUpdateUserDocument
  ): Promise<boolean> => {
    return this.userDocumentUpdaterRepository.updateUserDocumentById(
      userId,
      input
    );
  };

  updateUserAddressById = async (
    userId: string,
    input: IUpdateUserAddress
  ): Promise<boolean> => {
    return this.userAddressUpdaterRepository.updateUserAddressById(
      userId,
      input
    );
  };

  viewUserNamePhoto = async (
    userId: string
  ): Promise<IViewUserNamePhoto | null> => {
    return this.userNamePhotoViewerRepository.viewUserNamePhoto(userId);
  };
}
