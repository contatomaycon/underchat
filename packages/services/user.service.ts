import { injectable } from 'tsyringe';
import { ListUserRequest } from '@core/schema/user/listUser/request.schema';
import { ListUserResponse } from '@core/schema/user/listUser/response.schema';
import { UserListerRepository } from '@core/repositories/user/UserLister.repository';
import { UserAllListerRepository } from '@core/repositories/user/UserAllLister.repository';
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
import { UserUpdaterTransactionRepository } from '@core/repositories/user/UserUpdaterTransaction.repository';
import { IUpdateUser } from '@core/common/interfaces/IUpdateUser';
import { UserInfoUpdaterRepository } from '@core/repositories/user/UserInfoUpdater.repository';
import { IUpdateUserInfo } from '@core/common/interfaces/IUpdateUserInfo';
import { UserDocumentUpdaterRepository } from '@core/repositories/user/UserDocumentUpdater.repository';
import { IUpdateUserDocument } from '@core/common/interfaces/IUpdateUserDocument';
import { UserDocumentCreatorRepository } from '@core/repositories/user/UserDocumentCreator.repository';
import { ICreateUserDocument } from '@core/common/interfaces/ICreateUserDocument';
import { UserAddressUpdaterRepository } from '@core/repositories/user/UserAddressUpdater.repository';
import { IUpdateUserAddress } from '@core/common/interfaces/IUpdateUserAddress';
import { UserAddressCreatorRepository } from '@core/repositories/user/UserAddressCreator.repository';
import { ICreateUserAddress } from '@core/common/interfaces/ICreateUserAddress';
import { UserNamePhotoViewerRepository } from '@core/repositories/user/UserNamePhotoViewer.repository';
import { IViewUserNamePhoto } from '@core/common/interfaces/IViewUserNamePhoto';
import { UserExistsByEmailAndPhoneRepository } from '@core/repositories/user/UserExistsByEmailAndPhone.repository';
import { UserSensitiveDataRepository } from '@core/repositories/user/UserSensitiveData.repository';
import { AccountSettingsAdditionalInfoViewerRepository } from '@core/repositories/accountSettings/AccountSettingsAdditionalInfoViewer.repository';
import { ViewAdditionalInfoResponse } from '@core/schema/accountSettings/viewAdditionalInfo/response.schema';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { UserPasswordViewerRepository } from '@core/repositories/user/UserPasswordViewer.repository';
import { PermissionAssignmentCreatorRepository } from '@core/repositories/permission/PermissionAssignmentCreator.repository';
import { PermissionAssignmentExistsRepository } from '@core/repositories/permission/PermissionAssignmentExists.repository';
import { PermissionAssignmentViewerRepository } from '@core/repositories/permission/PermissionAssignmentViewer.repository';
import { PermissionAssignmentUpdaterRepository } from '@core/repositories/permission/PermissionAssignmentUpdater.repository';
import { PermissionAssignmentDeleterRepository } from '@core/repositories/permission/PermissionAssignmentDeleter.repository';
import { UserAccountViewerRepository } from '@core/repositories/user/UserAccountViewer.repository';
import { UserEmailViewerExistsRepository } from '@core/repositories/user/UserEmailViewerExists.repository';
import { UserTotalViewerRepository } from '@core/repositories/user/UserTotalViewer.repository';
import { UserOnlineListerRepository } from '@core/repositories/user/UserOnlineLister.repository';
import { UserTransferListerRepository } from '@core/repositories/user/UserTransferLister.repository';
import { UserMasterViewerRepository } from '@core/repositories/user/UserMasterViewer.repository';
import { UserSectorsListerRepository } from '@core/repositories/user/UserSectorsLister.repository';
import { UserSectorsUpdaterTransactionRepository } from '@core/repositories/user/UserSectorsUpdaterTransaction.repository';
import { EncryptService } from './encrypt.service';
import { IUserSensitiveDataDecrypted } from '@core/common/interfaces/IUserSensitiveDataDecrypted';
import { StorageService } from '@core/services/storage.service';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { IChat } from '@core/common/interfaces/IChat';
import { TransferUserResponse } from '@core/schema/chat/listTransferUsers/response.schema';
import { ListAllUsersResponse } from '@core/schema/user/listAllUsers/response.schema';

@injectable()
export class UserService {
  constructor(
    private readonly encryptService: EncryptService,
    private readonly userListerRepository: UserListerRepository,
    private readonly userAllListerRepository: UserAllListerRepository,
    private readonly userViewerExistsRepository: UserViewerExistsRepository,
    private readonly userDeleterRepository: UserDeleterRepository,
    private readonly userViewerRepository: UserViewerRepository,
    private readonly userStatusViewerExistsRepository: UserStatusViewerExistsRepository,
    private readonly userTransactionCreatorRepository: UserTransactionCreatorRepository,
    private readonly userDocumentTypeViewerExistsRepository: UserDocumentTypeViewerExistsRepository,
    private readonly userUpdaterRepository: UserUpdaterRepository,
    private readonly userUpdaterTransactionRepository: UserUpdaterTransactionRepository,
    private readonly userInfoUpdaterRepository: UserInfoUpdaterRepository,
    private readonly userDocumentUpdaterRepository: UserDocumentUpdaterRepository,
    private readonly userDocumentCreatorRepository: UserDocumentCreatorRepository,
    private readonly userAddressUpdaterRepository: UserAddressUpdaterRepository,
    private readonly userAddressCreatorRepository: UserAddressCreatorRepository,
    private readonly userNamePhotoViewerRepository: UserNamePhotoViewerRepository,
    private readonly userExistsByEmailAndPhoneRepository: UserExistsByEmailAndPhoneRepository,
    private readonly userSensitiveDataRepository: UserSensitiveDataRepository,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly permissionAssignmentCreatorRepository: PermissionAssignmentCreatorRepository,
    private readonly permissionAssignmentExistsRepository: PermissionAssignmentExistsRepository,
    private readonly permissionAssignmentViewerRepository: PermissionAssignmentViewerRepository,
    private readonly permissionAssignmentUpdaterRepository: PermissionAssignmentUpdaterRepository,
    private readonly permissionAssignmentDeleterRepository: PermissionAssignmentDeleterRepository,
    private readonly userAccountViewerRepository: UserAccountViewerRepository,
    private readonly userEmailViewerExistsRepository: UserEmailViewerExistsRepository,
    private readonly userTotalViewerRepository: UserTotalViewerRepository,
    private readonly userOnlineListerRepository: UserOnlineListerRepository,
    private readonly userTransferListerRepository: UserTransferListerRepository,
    private readonly storageService: StorageService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly accountSettingsAdditionalInfoViewerRepository: AccountSettingsAdditionalInfoViewerRepository,
    private readonly userPasswordViewerRepository: UserPasswordViewerRepository,
    private readonly userMasterViewerRepository: UserMasterViewerRepository,
    private readonly userSectorsListerRepository: UserSectorsListerRepository,
    private readonly userSectorsUpdaterTransactionRepository: UserSectorsUpdaterTransactionRepository
  ) {}

  listUsers = async (
    perPage: number,
    currentPage: number,
    query: ListUserRequest,
    accountId: string | null
  ): Promise<[ListUserResponse[], number]> => {
    const searchHashes = query.search
      ? this.encryptService.encrypt(query.search)
      : null;

    const [result, total] = await Promise.all([
      this.userListerRepository.listUsers(
        perPage,
        currentPage,
        query,
        accountId,
        searchHashes
      ),
      this.userListerRepository.listUsersTotal(query, accountId, searchHashes),
    ]);

    return [result, total];
  };

  listAllUsers = async (accountId: string): Promise<ListAllUsersResponse[]> => {
    return this.userAllListerRepository.listAllUsers(accountId);
  };

  existsUserById = async (
    userId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.userViewerExistsRepository.existsUserById(userId, accountId);
  };

  deleteUserById = async (
    userId: string,
    accountId: string
  ): Promise<boolean> => {
    return this.userDeleterRepository.deleteUserById(userId, accountId);
  };

  viewUserById = async (
    userId: string,
    accountId: string
  ): Promise<ViewUserResponse | null> => {
    return this.userViewerRepository.viewUserById(userId, accountId);
  };

  existsUserStatusById = async (userStatusId: string): Promise<boolean> => {
    return this.userStatusViewerExistsRepository.existsUserStatusById(
      userStatusId
    );
  };

  createUser = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateUserRequest,
    photoUrl?: string | null
  ): Promise<boolean> => {
    return this.userTransactionCreatorRepository.createUser(
      t,
      accountId,
      input,
      photoUrl
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

  updateUserByIdWithAccountChange = async (
    t: TFunction<'translation', undefined>,
    userId: string,
    input: IUpdateUser,
    newAccountId: string,
    currentAccountId: string
  ): Promise<boolean> => {
    return this.userUpdaterTransactionRepository.updateUserWithAccountChange(
      t,
      userId,
      input,
      newAccountId,
      currentAccountId
    );
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

  existsUserDocumentByUserId = async (userId: string): Promise<boolean> => {
    return this.userDocumentUpdaterRepository.existsUserDocumentByUserId(
      userId
    );
  };

  deleteUserDocumentById = async (userId: string): Promise<boolean> => {
    return this.userDocumentUpdaterRepository.deleteUserDocumentById(userId);
  };

  createUserDocumentWithoutTransaction = async (
    input: ICreateUserDocument,
    userId: string
  ): Promise<boolean> => {
    return this.userDocumentCreatorRepository.createUserDocumentWithoutTransaction(
      input,
      userId
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

  deleteUserAddressById = async (userId: string): Promise<boolean> => {
    return this.userAddressUpdaterRepository.deleteUserAddressById(userId);
  };

  existsUserAddressByUserId = async (userId: string): Promise<boolean> => {
    return this.userAddressUpdaterRepository.existsUserAddressByUserId(userId);
  };

  createUserAddressWithoutTransaction = async (
    input: ICreateUserAddress,
    userId: string
  ): Promise<boolean> => {
    return this.userAddressCreatorRepository.createUserAddressWithoutTransaction(
      input,
      userId
    );
  };

  viewUserNamePhoto = async (
    userId: string
  ): Promise<IViewUserNamePhoto | null> => {
    return this.userNamePhotoViewerRepository.viewUserNamePhoto(userId);
  };

  listOnlineUsersByAccount = async (
    accountId: string
  ): Promise<IViewUserNamePhoto[]> => {
    return this.userOnlineListerRepository.listOnlineUsersByAccount(accountId);
  };

  getAvailableUserWithLeastChats = async (
    accountId: string
  ): Promise<IViewUserNamePhoto | null> => {
    const onlineUsers = await this.listOnlineUsersByAccount(accountId);

    if (onlineUsers.length === 0) {
      return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const userChatCounts = await Promise.all(
      onlineUsers.map(async (user) => {
        const inChatQuery: any = {
          size: 0,
          query: {
            bool: {
              must: [
                {
                  nested: {
                    path: 'account',
                    query: {
                      term: {
                        'account.id': accountId,
                      },
                    },
                  },
                },
                {
                  nested: {
                    path: 'user',
                    query: {
                      term: {
                        'user.id': user.id,
                      },
                    },
                  },
                },
              ],
              filter: [
                {
                  term: {
                    status: EChatStatus.in_chat,
                  },
                },
              ],
            },
          },
        };

        const inChatResult = await this.elasticDatabaseService.select<IChat>(
          EElasticIndex.chat,
          inChatQuery
        );
        const inChatCount =
          (inChatResult?.hits?.total as { value: number })?.value ?? 0;

        if (inChatCount > 0) {
          return { user, inChatCount, closedTodayCount: Infinity };
        }

        const closedTodayQuery: any = {
          size: 0,
          query: {
            bool: {
              must: [
                {
                  nested: {
                    path: 'account',
                    query: {
                      term: {
                        'account.id': accountId,
                      },
                    },
                  },
                },
                {
                  nested: {
                    path: 'user',
                    query: {
                      term: {
                        'user.id': user.id,
                      },
                    },
                  },
                },
              ],
              filter: [
                {
                  term: {
                    status: EChatStatus.closed,
                  },
                },
                {
                  range: {
                    closed_at: {
                      gte: todayISO,
                    },
                  },
                },
              ],
            },
          },
        };

        const closedTodayResult =
          await this.elasticDatabaseService.select<IChat>(
            EElasticIndex.chat,
            closedTodayQuery
          );
        const closedTodayCount =
          (closedTodayResult?.hits?.total as { value: number })?.value ?? 0;

        return { user, inChatCount, closedTodayCount };
      })
    );

    const availableUsers = userChatCounts.filter((uc) => uc.inChatCount === 0);
    if (availableUsers.length === 0) {
      return null;
    }

    availableUsers.sort((a, b) => a.closedTodayCount - b.closedTodayCount);

    return availableUsers[0].user;
  };

  existsUserByEmail = async (
    emailC: string,
    excludeUserId?: string | null
  ): Promise<boolean> => {
    return this.userExistsByEmailAndPhoneRepository.existsUserByEmail(
      emailC,
      excludeUserId
    );
  };

  existsUserByPhone = async (
    phoneC: string,
    excludeUserId?: string | null
  ): Promise<boolean> => {
    return this.userExistsByEmailAndPhoneRepository.existsUserByPhone(
      phoneC,
      excludeUserId
    );
  };

  getUserPhoneDecrypted = (
    encryptedPhone: string | null | undefined
  ): string | null => {
    if (!encryptedPhone) return null;

    if (typeof encryptedPhone !== 'string') {
      return null;
    }

    const isAESFormat =
      encryptedPhone.includes(':') && encryptedPhone.split(':').length === 3;

    if (!isAESFormat) {
      return null;
    }

    try {
      const decryptedPhone =
        this.passwordEncryptorService.decrypt(encryptedPhone);

      return decryptedPhone;
    } catch {
      return null;
    }
  };

  getUserPhoneJidDecrypted = (
    encryptedPhoneJid: string | null | undefined
  ): string | null => {
    if (!encryptedPhoneJid) return null;

    if (typeof encryptedPhoneJid !== 'string') {
      return null;
    }

    const isAESFormat =
      encryptedPhoneJid.includes(':') &&
      encryptedPhoneJid.split(':').length === 3;

    if (!isAESFormat) {
      return null;
    }

    try {
      const decryptedPhone =
        this.passwordEncryptorService.decrypt(encryptedPhoneJid);

      return decryptedPhone;
    } catch {
      return null;
    }
  };

  getUserEmailDecrypted = (
    encryptedEmail: string | null | undefined
  ): string | null => {
    if (!encryptedEmail) return null;

    if (typeof encryptedEmail !== 'string') {
      return null;
    }

    if (encryptedEmail.includes('*')) {
      return null;
    }

    const isAESFormat =
      encryptedEmail.includes(':') && encryptedEmail.split(':').length === 3;

    if (!isAESFormat) {
      return null;
    }

    try {
      const decryptedEmail =
        this.passwordEncryptorService.decrypt(encryptedEmail);

      return decryptedEmail;
    } catch {
      return null;
    }
  };

  getUserDocumentDecrypted = (
    encryptedDocument: string | null | undefined
  ): string | null => {
    if (!encryptedDocument) return null;

    if (typeof encryptedDocument !== 'string') {
      return null;
    }

    if (encryptedDocument.includes('*')) {
      return null;
    }

    const isAESFormat =
      encryptedDocument.includes(':') &&
      encryptedDocument.split(':').length === 3;

    if (!isAESFormat) {
      return null;
    }

    try {
      const decryptedDocument =
        this.passwordEncryptorService.decrypt(encryptedDocument);

      return decryptedDocument;
    } catch {
      return null;
    }
  };

  getUserSensitiveDataRaw = async (
    userId: string
  ): Promise<IUserSensitiveDataDecrypted | null> => {
    return this.userSensitiveDataRepository.getUserSensitiveDataById(userId);
  };

  getUserSensitiveDataDecrypted = async (
    userId: string
  ): Promise<IUserSensitiveDataDecrypted | null> => {
    const sensitiveData =
      await this.userSensitiveDataRepository.getUserSensitiveDataById(userId);

    if (!sensitiveData) return null;

    return {
      phone: this.getUserPhoneDecrypted(sensitiveData.phone),
      email: this.getUserEmailDecrypted(sensitiveData.email),
      document: this.getUserDocumentDecrypted(sensitiveData.document),
      address1: this.getUserAddress1Decrypted(sensitiveData.address1),
      address2: this.getUserAddress2Decrypted(sensitiveData.address2),
    };
  };

  getUserAddress1Decrypted = (
    encryptedAddress1: string | null | undefined
  ): string | null => {
    if (!encryptedAddress1) return null;

    if (typeof encryptedAddress1 !== 'string') {
      return null;
    }

    if (encryptedAddress1.includes('*')) {
      return null;
    }

    const isAESFormat =
      encryptedAddress1.includes(':') &&
      encryptedAddress1.split(':').length === 3;

    if (!isAESFormat) {
      return null;
    }

    try {
      const decryptedAddress1 =
        this.passwordEncryptorService.decrypt(encryptedAddress1);

      return decryptedAddress1;
    } catch {
      return null;
    }
  };

  getUserAddress2Decrypted = (
    encryptedAddress2: string | null | undefined
  ): string | null => {
    if (!encryptedAddress2) return null;

    if (typeof encryptedAddress2 !== 'string') {
      return null;
    }

    if (encryptedAddress2.includes('*')) {
      return null;
    }

    const isAESFormat =
      encryptedAddress2.includes(':') &&
      encryptedAddress2.split(':').length === 3;

    if (!isAESFormat) {
      return null;
    }

    try {
      const decryptedAddress2 =
        this.passwordEncryptorService.decrypt(encryptedAddress2);

      return decryptedAddress2;
    } catch {
      return null;
    }
  };

  getUserRole = async (userId: string): Promise<string | null> => {
    return this.permissionAssignmentViewerRepository.getUserRole(userId);
  };

  assignUserRole = async (
    userId: string,
    permissionRoleId: string
  ): Promise<boolean> => {
    const currentRole = await this.getUserRole(userId);

    if (currentRole) {
      return this.permissionAssignmentUpdaterRepository.updatePermissionAssignment(
        userId,
        permissionRoleId
      );
    }

    const assignmentId =
      await this.permissionAssignmentCreatorRepository.createPermissionAssignment(
        userId,
        permissionRoleId
      );

    return assignmentId !== null;
  };

  existsPermissionAssignment = async (
    userId: string,
    permissionRoleId: string
  ): Promise<boolean> => {
    return this.permissionAssignmentExistsRepository.existsPermissionAssignment(
      userId,
      permissionRoleId
    );
  };

  deleteUserRole = async (userId: string): Promise<boolean> => {
    return this.permissionAssignmentDeleterRepository.deletePermissionAssignmentByUserId(
      userId
    );
  };

  getUserAccountId = async (userId: string): Promise<string | null> => {
    return this.userAccountViewerRepository.getUserAccountId(userId);
  };

  listUserSectors = async (
    accountId: string,
    userId: string
  ): Promise<string[]> => {
    return this.userSectorsListerRepository.listUserSectors(accountId, userId);
  };

  updateUserSectors = async (
    t: TFunction<'translation', undefined>,
    userId: string,
    sectorIds: string[]
  ): Promise<boolean> => {
    return this.userSectorsUpdaterTransactionRepository.updateUserSectors(
      t,
      userId,
      sectorIds
    );
  };

  existsUserEmailById = async (userEmail: string): Promise<boolean> => {
    const emailC = this.encryptService.encrypt(userEmail);

    if (!emailC) return false;

    return this.userEmailViewerExistsRepository.existsUserEmailById(emailC);
  };

  totalUserByAccount = async (accountId: string): Promise<number> => {
    return this.userTotalViewerRepository.totalUserByAccount(accountId);
  };

  uploadUserPhoto = async (
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    photo?: UploadFileRequest | null,
    removePhoto = false
  ): Promise<string | null> => {
    const updateData: IUpdateUserInfo = {};

    if (removePhoto) {
      updateData.photo = null;
    }

    if (photo && !removePhoto) {
      const uploadResult = await this.storageService.uploadImage(
        photo,
        accountId
      );

      if (!uploadResult) {
        throw new Error(t('profile_photo_upload_error'));
      }

      updateData.photo = uploadResult.url;
    }

    if (!removePhoto && !photo) {
      return null;
    }

    const updated = await this.userInfoUpdaterRepository.updateUserInfoById(
      userId,
      updateData
    );

    if (!updated) {
      throw new Error(t('profile_photo_upload_error'));
    }

    return updateData.photo ?? null;
  };

  listUsersForTransfer = async (
    accountId: string
  ): Promise<TransferUserResponse[]> => {
    return this.userTransferListerRepository.listUsersForTransfer(accountId);
  };

  viewAdditionalInfo = async (
    userId: string
  ): Promise<ViewAdditionalInfoResponse | null> => {
    return this.accountSettingsAdditionalInfoViewerRepository.viewAdditionalInfoByUserId(
      userId
    );
  };

  verifyUserPassword = async (
    userId: string,
    accountId: string,
    currentPassword: string
  ): Promise<boolean> => {
    const encryptedPassword =
      await this.userPasswordViewerRepository.viewUserPasswordById(
        userId,
        accountId
      );

    if (!encryptedPassword) {
      return false;
    }

    const currentPasswordEncrypted =
      this.encryptService.encrypt(currentPassword);

    return encryptedPassword === currentPasswordEncrypted;
  };

  updateUserPassword = async (
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    newPassword: string
  ): Promise<boolean> => {
    const newPasswordEncrypted = this.encryptService.encrypt(newPassword);

    const input: IUpdateUser = {
      password: newPasswordEncrypted,
    };

    return this.userUpdaterRepository.updateUserById(userId, input, accountId);
  };

  updateUserPhoneJid = async (
    userId: string,
    phoneJid: string
  ): Promise<boolean> => {
    const phoneJidEncrypted = this.passwordEncryptorService.encrypt(phoneJid);

    return this.userInfoUpdaterRepository.updatePhoneJidById(
      userId,
      phoneJidEncrypted
    );
  };

  findMasterUserByAccountId = async (
    accountId: string
  ): Promise<{
    user_id: string;
    email: string;
    account_id: string;
    account_name: string | null;
  } | null> => {
    return this.userMasterViewerRepository.findMasterUserByAccountId(accountId);
  };
}
