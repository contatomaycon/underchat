import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateUserRequest } from '@core/schema/user/editUser/request.schema';
import { UserService } from '@core/services/user.service';
import { EncryptService } from '@core/services/encrypt.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { IUpdateUser } from '@core/common/interfaces/IUpdateUser';
import { IUpdateUserInfo } from '@core/common/interfaces/IUpdateUserInfo';
import moment from 'moment';
import { IUpdateUserDocument } from '@core/common/interfaces/IUpdateUserDocument';
import { IUpdateUserAddress } from '@core/common/interfaces/IUpdateUserAddress';
import { ICreateUserAddress } from '@core/common/interfaces/ICreateUserAddress';
import { ICreateUserDocument } from '@core/common/interfaces/ICreateUserDocument';
import { CountryService } from '@core/services/country.service';
import { AccountService } from '@core/services/account.service';
import { StorageService } from '@core/services/storage.service';
import { PermissionService } from '@core/services/permission.service';
import { validatePassword } from '@core/common/utils/passwordValidator';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';

@injectable()
export class UserUpdaterUseCase {
  constructor(
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(CountryService)
    private readonly countryService: CountryService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(PermissionService)
    private readonly permissionService: PermissionService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  private extractStringValue(
    field: { value: string | null } | null | undefined
  ): string | null {
    const value = field?.value ?? null;
    if (value === '') {
      return null;
    }
    return value;
  }

  private extractOptionalStringValue(
    field: { value: string | null } | null | undefined
  ): string | null | undefined {
    if (field === undefined) {
      return undefined;
    }
    const value = field?.value ?? null;
    if (value === '') {
      return null;
    }
    return value;
  }

  private extractPhotoUrlValue(
    field: { value: string | null } | null | undefined
  ): string | null {
    const value = field?.value ?? null;
    return value === '' ? null : value;
  }

  private async processPhotoUpload(
    t: TFunction<'translation', undefined>,
    body: UpdateUserRequest,
    accountId: string
  ): Promise<string | null> {
    if (body.photo_url !== undefined) {
      const photoUrlValue = this.extractPhotoUrlValue(body.photo_url);
      return photoUrlValue;
    }

    if (body.photo) {
      const uploadResult = await this.storageService.uploadImage(
        body.photo,
        accountId
      );

      if (!uploadResult) {
        throw new Error(t('profile_info_photo_upload_error'));
      }

      return uploadResult.url;
    }

    return null;
  }

  private extractNumberValue(
    field: { value: number | null } | null | undefined
  ): number | null {
    return field?.value ?? null;
  }

  private validateBirthDate(
    t: TFunction<'translation', undefined>,
    birthDate: string
  ): string {
    if (!moment(birthDate, 'YYYY-MM-DD', true).isValid()) {
      throw new Error(t('date_must_be_in_the_format_yyyy_mm_dd'));
    }

    const birth = moment(birthDate, 'YYYY-MM-DD');
    const minDate = moment('1900-01-01', 'YYYY-MM-DD');
    const today = moment().startOf('day');

    if (birth.isBefore(minDate)) {
      throw new Error(t('date_must_be_greater_than_1900_01_01'));
    }

    if (!birth.isBefore(today)) {
      throw new Error(t('date_must_be_less_than_today'));
    }

    return birthDate;
  }

  private async validateAccount(
    t: TFunction<'translation', undefined>,
    accountId: { value: string | null } | null | undefined
  ): Promise<void> {
    const accountIdValue = this.extractStringValue(accountId);
    if (!accountIdValue) {
      return;
    }

    const accountExists =
      await this.accountService.existsAccountById(accountIdValue);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }
  }

  private async validateUserStatus(
    t: TFunction<'translation', undefined>,
    userStatusId: { value: string | null } | null | undefined
  ): Promise<void> {
    const userStatusIdValue = this.extractStringValue(userStatusId);
    if (!userStatusIdValue) {
      return;
    }

    const userStatusExists =
      await this.userService.existsUserStatusById(userStatusIdValue);

    if (!userStatusExists) {
      throw new Error(t('user_status_not_found'));
    }
  }

  private async validateEmail(
    t: TFunction<'translation', undefined>,
    email: { value: string | null } | null | undefined,
    userId: string
  ): Promise<void> {
    const emailValue = this.extractStringValue(email);
    if (!emailValue) {
      return;
    }

    const emailC = this.encryptService.encrypt(emailValue);
    const exists = await this.userService.existsUserByEmail(emailC, userId);

    if (exists) {
      throw new Error(t('user_already_exists_email'));
    }
  }

  private async validateUserDocumentType(
    t: TFunction<'translation', undefined>,
    documentTypeId: { value: string | null } | null | undefined
  ): Promise<void> {
    const documentTypeIdValue = this.extractStringValue(documentTypeId);
    if (!documentTypeIdValue) {
      return;
    }

    const documentTypeExists =
      await this.userService.existsUserDocumentTypeById(documentTypeIdValue);

    if (!documentTypeExists) {
      throw new Error(t('user_document_type_not_found'));
    }
  }

  private async validateCountry(
    t: TFunction<'translation', undefined>,
    countryId: { value: number | null } | null | undefined
  ): Promise<void> {
    const countryIdValue = this.extractNumberValue(countryId);
    if (!countryIdValue) {
      return;
    }

    const countryExists =
      await this.countryService.existsCountryById(countryIdValue);

    if (!countryExists) {
      throw new Error(t('country_not_found'));
    }
  }

  private async validatePhoneUniqueness(
    t: TFunction<'translation', undefined>,
    phoneC: string | null,
    userId: string
  ): Promise<void> {
    if (!phoneC) {
      return;
    }

    const exists = await this.userService.existsUserByPhone(phoneC, userId);

    if (exists) {
      throw new Error(t('user_already_exists_phone'));
    }
  }

  private encryptEmailData(email: { value: string | null } | null | undefined) {
    const emailValue = this.extractStringValue(email);
    if (!emailValue) {
      return {
        emailCEncrypted: null,
        emailPartialEncrypted: null,
        emailC: null,
      };
    }

    return {
      emailCEncrypted: this.passwordEncryptorService.encrypt(emailValue),
      emailPartialEncrypted: this.encryptService.sanitize(
        emailValue,
        ETypeSanetize.email
      ),
      emailC: this.encryptService.encrypt(emailValue),
    };
  }

  private encryptPhoneData(phone: string | null | undefined) {
    if (!phone) {
      return {
        phoneCEncrypted: null,
        phonePartialEncrypted: null,
        phoneC: null,
      };
    }

    return {
      phoneCEncrypted: this.passwordEncryptorService.encrypt(phone),
      phonePartialEncrypted: this.encryptService.sanitize(
        phone,
        ETypeSanetize.phone
      ),
      phoneC: this.encryptService.encrypt(phone),
    };
  }

  private encryptDocumentData(document: string | null | undefined) {
    if (!document) {
      return {
        documentCEncrypted: null,
        documentPartialEncrypted: null,
        documentC: null,
      };
    }

    return {
      documentCEncrypted: this.passwordEncryptorService.encrypt(document),
      documentPartialEncrypted: this.encryptService.sanitize(
        document,
        ETypeSanetize.document
      ),
      documentC: this.encryptService.encrypt(document),
    };
  }

  private encryptAddressData(address: string | null | undefined) {
    if (!address) {
      return {
        addressCEncrypted: null,
        addressPartialEncrypted: null,
        addressC: null,
      };
    }

    return {
      addressCEncrypted: this.passwordEncryptorService.encrypt(address),
      addressPartialEncrypted: this.encryptService.sanitize(
        address,
        ETypeSanetize.other
      ),
      addressC: this.encryptService.encrypt(address),
    };
  }

  private buildUpdateUserInput(
    t: TFunction<'translation', undefined>,
    body: UpdateUserRequest
  ): IUpdateUser {
    const emailData = this.encryptEmailData(body.email);
    const passwordValue = this.extractStringValue(body.password);

    if (passwordValue) {
      const passwordValidation = validatePassword(passwordValue);
      if (!passwordValidation.isValid) {
        const errorMessages = passwordValidation.errors.map((err) => t(err));
        throw new Error(errorMessages.join(', '));
      }
    }

    const passwordEncrypted = passwordValue
      ? this.encryptService.encrypt(passwordValue)
      : null;

    return {
      user_status_id: this.extractStringValue(body.user_status_id),
      email: emailData.emailCEncrypted,
      email_partial: emailData.emailPartialEncrypted,
      email_c: emailData.emailC,
      password: passwordEncrypted,
    };
  }

  private buildUpdateUserInfoInput(
    t: TFunction<'translation', undefined>,
    body: UpdateUserRequest,
    photoUrl: string | null
  ): IUpdateUserInfo {
    const phoneValue = this.extractOptionalStringValue(body.phone);
    const phoneData =
      phoneValue === undefined ? undefined : this.encryptPhoneData(phoneValue);
    const birthDateValue = this.extractOptionalStringValue(body.birth_date);
    const birthDate =
      birthDateValue === undefined
        ? undefined
        : birthDateValue
          ? this.validateBirthDate(t, birthDateValue)
          : null;

    return {
      phone_ddi: this.extractOptionalStringValue(body.phone_ddi),
      phone: phoneData?.phoneCEncrypted,
      phone_partial: phoneData?.phonePartialEncrypted,
      phone_c: phoneData?.phoneC,
      name: this.extractOptionalStringValue(body.name),
      last_name: this.extractOptionalStringValue(body.last_name),
      birth_date: birthDate,
      photo: photoUrl,
    };
  }

  private async deleteUserPhotoFromStorage(userId: string): Promise<void> {
    const userPhoto = await this.userService.viewUserNamePhoto(userId);

    if (!userPhoto?.photo) {
      return;
    }

    await this.storageService.deleteImage(userPhoto.photo);
  }

  private buildUpdateUserDocumentInput(
    body: UpdateUserRequest
  ): IUpdateUserDocument {
    const documentValue = this.extractStringValue(body.document);
    const documentData = this.encryptDocumentData(documentValue);

    return {
      user_document_type_id: this.extractStringValue(body.document_type_id),
      document: documentData.documentCEncrypted,
      document_partial: documentData.documentPartialEncrypted,
      document_c: documentData.documentC,
    };
  }

  private buildCreateUserDocumentInput(
    body: UpdateUserRequest
  ): ICreateUserDocument {
    const documentValue = this.extractStringValue(body.document);
    const documentData = this.encryptDocumentData(documentValue);
    const documentTypeIdValue = this.extractStringValue(body.document_type_id);

    if (!documentTypeIdValue) {
      throw new Error('user_document_type_id is required to create document');
    }

    return {
      user_document_type_id: documentTypeIdValue,
      document: documentData.documentCEncrypted,
      document_partial: documentData.documentPartialEncrypted,
      document_c: documentData.documentC,
    };
  }

  private buildUpdateUserAddressInput(
    body: UpdateUserRequest
  ): IUpdateUserAddress {
    const address1Value = this.extractStringValue(body.address1);
    const address2Value = this.extractStringValue(body.address2);
    const address1Data = this.encryptAddressData(address1Value);
    const address2Data = this.encryptAddressData(address2Value);

    return {
      country_id: this.extractNumberValue(body.country_id),
      zip_code: this.extractStringValue(body.zip_code),
      address1: address1Data.addressCEncrypted,
      address1_partial: address1Data.addressPartialEncrypted,
      address1_c: address1Data.addressC,
      address2: address2Data.addressCEncrypted,
      address2_partial: address2Data.addressPartialEncrypted,
      address2_c: address2Data.addressC,
      city_fiscal_code: this.extractStringValue(body.city_fiscal_code),
      state_fiscal_code: this.extractStringValue(body.state_fiscal_code),
      district: this.extractStringValue(body.district),
    };
  }

  private buildCreateUserAddressInput(
    body: UpdateUserRequest
  ): ICreateUserAddress {
    const address1Value = this.extractStringValue(body.address1);
    const address2Value = this.extractStringValue(body.address2);
    const address1Data = this.encryptAddressData(address1Value);
    const address2Data = this.encryptAddressData(address2Value);
    const countryIdValue = this.extractNumberValue(body.country_id);

    if (!countryIdValue) {
      throw new Error('country_id is required to create address');
    }

    return {
      country_id: countryIdValue,
      zip_code: this.extractStringValue(body.zip_code),
      address1: address1Data.addressCEncrypted,
      address1_partial: address1Data.addressPartialEncrypted,
      address1_c: address1Data.addressC,
      address2: address2Data.addressCEncrypted,
      address2_partial: address2Data.addressPartialEncrypted,
      address2_c: address2Data.addressC,
      city_fiscal_code: this.extractStringValue(body.city_fiscal_code),
      state_fiscal_code: this.extractStringValue(body.state_fiscal_code),
      district: this.extractStringValue(body.district),
    };
  }

  private async validateUserFields(
    t: TFunction<'translation', undefined>,
    body: UpdateUserRequest,
    userId: string
  ): Promise<void> {
    await Promise.all([
      this.validateAccount(t, body.account_id),
      this.validateUserStatus(t, body.user_status_id),
      this.validateEmail(t, body.email, userId),
    ]);
  }

  private async validateUserInfoFields(
    t: TFunction<'translation', undefined>,
    body: UpdateUserRequest,
    userId: string
  ): Promise<void> {
    const phoneValue = this.extractStringValue(body.phone);
    const phoneData = this.encryptPhoneData(phoneValue);
    await this.validatePhoneUniqueness(t, phoneData.phoneC, userId);
  }

  private async validateUserDocumentFields(
    t: TFunction<'translation', undefined>,
    body: UpdateUserRequest
  ): Promise<void> {
    await this.validateUserDocumentType(t, body.document_type_id);
  }

  private async validateUserAddressFields(
    t: TFunction<'translation', undefined>,
    body: UpdateUserRequest
  ): Promise<void> {
    await this.validateCountry(t, body.country_id);
  }

  private async resolveAccountIdForUpdate(
    userId: string,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<string> {
    const currentAccountId =
      (await this.userService.getUserAccountId(userId)) ?? null;

    if (!canOperateOnOthers) {
      return currentAccountId ?? accountId;
    }

    return currentAccountId ?? accountId ?? null;
  }

  private async handleAccountChange(
    t: TFunction<'translation', undefined>,
    userId: string,
    updateUserInput: IUpdateUser,
    accountIdValue: string,
    currentAccountId: string
  ): Promise<void> {
    updateUserInput.account_id = accountIdValue;

    await this.userService.updateUserByIdWithAccountChange(
      t,
      userId,
      updateUserInput,
      accountIdValue,
      currentAccountId
    );
  }

  private async updateUserWithoutAccountChange(
    t: TFunction<'translation', undefined>,
    userId: string,
    updateUserInput: IUpdateUser,
    accountIdForUpdate: string
  ): Promise<void> {
    const updateUser = await this.userService.updateUserById(
      userId,
      updateUserInput,
      accountIdForUpdate
    );

    if (!updateUser) {
      throw new Error(t('user_update_failed'));
    }
  }

  private async updateUserData(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<void> {
    const currentAccountId =
      (await this.userService.getUserAccountId(userId)) ?? null;
    const accountIdForUpdate = await this.resolveAccountIdForUpdate(
      userId,
      accountId,
      canOperateOnOthers
    );

    if (!accountIdForUpdate) {
      throw new Error(t('account_not_found'));
    }

    const updateUserInput = this.buildUpdateUserInput(t, body);
    const accountIdValue = this.extractStringValue(body.account_id);
    const hasAccountChange =
      accountIdValue && currentAccountId && accountIdValue !== currentAccountId;

    if (hasAccountChange && accountIdValue && currentAccountId) {
      await this.handleAccountChange(
        t,
        userId,
        updateUserInput,
        accountIdValue,
        currentAccountId
      );
      return;
    }

    await this.updateUserWithoutAccountChange(
      t,
      userId,
      updateUserInput,
      accountIdForUpdate
    );
  }

  private async resolveAccountIdForUserInfo(
    userId: string,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<string> {
    if (!canOperateOnOthers) {
      return accountId;
    }

    const userAccountId = await this.userService.getUserAccountId(userId);
    return userAccountId ?? accountId;
  }

  private async updateUserInfoData(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<void> {
    const accountIdToUse = await this.resolveAccountIdForUserInfo(
      userId,
      accountId,
      canOperateOnOthers
    );
    const photoUrlValue = this.extractPhotoUrlValue(body.photo_url);

    if (photoUrlValue === null) {
      await this.deleteUserPhotoFromStorage(userId);
    }

    const photoUrl = await this.processPhotoUpload(t, body, accountIdToUse);

    const userInfo = this.buildUpdateUserInfoInput(t, body, photoUrl);
    const updateUserInfo = await this.userService.updateUserInfoById(
      userId,
      userInfo
    );

    if (!updateUserInfo) {
      throw new Error(t('user_info_update_failed'));
    }
  }

  private async updateUserDocumentData(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest
  ): Promise<void> {
    const documentTypeIdWasProvided = body.document_type_id !== undefined;
    const documentTypeIdValue = this.extractStringValue(body.document_type_id);
    const documentWasProvided = body.document !== undefined;
    const documentValue = this.extractStringValue(body.document);

    if (
      (documentTypeIdWasProvided && documentTypeIdValue === null) ||
      (documentWasProvided &&
        (documentValue === null || documentValue === undefined))
    ) {
      const documentExists =
        await this.userService.existsUserDocumentByUserId(userId);

      if (documentExists) {
        await this.userService.deleteUserDocumentById(userId);
      }

      return;
    }

    const documentExists =
      await this.userService.existsUserDocumentByUserId(userId);

    if (!documentExists) {
      const createUserDocument = this.buildCreateUserDocumentInput(body);
      const createResult =
        await this.userService.createUserDocumentWithoutTransaction(
          createUserDocument,
          userId
        );

      if (!createResult) {
        throw new Error(t('user_document_create_failed'));
      }

      return;
    }

    const userDocument = this.buildUpdateUserDocumentInput(body);
    const updateUserDocument = await this.userService.updateUserDocumentById(
      userId,
      userDocument
    );

    if (!updateUserDocument) {
      throw new Error(t('user_document_update_failed'));
    }
  }

  private async updateUserAddressData(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest
  ): Promise<void> {
    const countryIdWasProvided = body.country_id !== undefined;
    const countryIdValue = this.extractNumberValue(body.country_id);

    if (
      countryIdWasProvided &&
      (countryIdValue === null || countryIdValue === undefined)
    ) {
      await this.userService.deleteUserAddressById(userId);
      return;
    }

    const addressExists =
      await this.userService.existsUserAddressByUserId(userId);

    if (!addressExists) {
      if (!countryIdValue) {
        return;
      }

      const createUserAddress = this.buildCreateUserAddressInput(body);
      const createResult =
        await this.userService.createUserAddressWithoutTransaction(
          createUserAddress,
          userId
        );

      if (!createResult) {
        throw new Error(t('user_address_create_failed'));
      }

      return;
    }

    const userAddress = this.buildUpdateUserAddressInput(body);
    const updateUserAddress = await this.userService.updateUserAddressById(
      userId,
      userAddress
    );

    if (!updateUserAddress) {
      throw new Error(t('user_address_update_failed'));
    }
  }

  private hasUserFields(body: UpdateUserRequest): boolean {
    return !!(
      body.email?.value ||
      body.password?.value ||
      body.user_status_id?.value ||
      body.account_id?.value
    );
  }

  private hasUserInfoFields(body: UpdateUserRequest): boolean {
    return (
      body.phone_ddi !== undefined ||
      body.phone !== undefined ||
      body.name !== undefined ||
      body.last_name !== undefined ||
      body.birth_date !== undefined ||
      body.photo_url !== undefined ||
      body.photo !== undefined
    );
  }

  private hasUserDocumentFields(body: UpdateUserRequest): boolean {
    return body.document_type_id !== undefined || body.document !== undefined;
  }

  private hasUserAddressFields(body: UpdateUserRequest): boolean {
    return !!(
      body.country_id !== undefined ||
      body.zip_code !== undefined ||
      body.address1 !== undefined ||
      body.address2 !== undefined ||
      body.district !== undefined
    );
  }

  private hasPermissionRoleIdField(body: UpdateUserRequest): boolean {
    return body.permission_role_id !== undefined;
  }

  private hasSectorIdsField(body: UpdateUserRequest): boolean {
    return body.sector_ids !== undefined;
  }

  private hasChannelIdsField(body: UpdateUserRequest): boolean {
    return body.channel_ids !== undefined;
  }

  private async validatePermissionRoleExists(
    t: TFunction<'translation', undefined>,
    permissionRoleId: string,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<void> {
    if (!canOperateOnOthers) {
      const existsPermissionRole =
        await this.permissionService.existsPermissionRoleById(
          accountId,
          permissionRoleId
        );

      if (!existsPermissionRole) {
        throw new Error(t('permission_role_not_found'));
      }
      return;
    }

    const permissionRoleAccountId =
      await this.permissionService.getPermissionRoleAccountId(permissionRoleId);

    if (!permissionRoleAccountId) {
      throw new Error(t('permission_role_not_found'));
    }
  }

  private async assignUserRoleToUser(
    t: TFunction<'translation', undefined>,
    userId: string,
    permissionRoleId: string,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<void> {
    const userAccountId = await this.userService.getUserAccountId(userId);
    if (!userAccountId) {
      throw new Error(t('user_not_found'));
    }

    const accountIdForValidation = canOperateOnOthers
      ? userAccountId
      : accountId;

    await this.validatePermissionRoleExists(
      t,
      permissionRoleId,
      accountIdForValidation,
      canOperateOnOthers
    );

    const assigned = await this.userService.assignUserRole(
      userId,
      permissionRoleId
    );

    if (!assigned) {
      throw new Error(t('user_role_assignment_failed'));
    }
  }

  private async removeUserRoleFromUser(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<void> {
    const currentRole = await this.userService.getUserRole(userId);

    if (!currentRole) {
      return;
    }

    const deleted = await this.userService.deleteUserRole(userId);

    if (!deleted) {
      throw new Error(t('user_role_deletion_failed'));
    }
  }

  private async updateUserRoleData(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<void> {
    const permissionRoleIdValue = this.extractStringValue(
      body.permission_role_id
    );

    if (permissionRoleIdValue) {
      await this.assignUserRoleToUser(
        t,
        userId,
        permissionRoleIdValue,
        accountId,
        canOperateOnOthers
      );
      return;
    }

    await this.removeUserRoleFromUser(t, userId);
  }

  private async updateUserSectorsData(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest
  ): Promise<void> {
    if (body.sector_ids?.value === null) {
      await this.userService.updateUserSectors(t, userId, []);
      return;
    }

    const sectorIdsValue = body.sector_ids?.value;
    const sectorIds = Array.isArray(sectorIdsValue) ? sectorIdsValue : [];

    await this.userService.updateUserSectors(t, userId, sectorIds);
  }

  private async updateUserChannelsData(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest
  ): Promise<void> {
    const accountId = await this.userService.getUserAccountId(userId);

    if (!accountId) {
      throw new Error(t('user_not_found'));
    }

    if (body.channel_ids?.value === null) {
      await this.userService.updateUserChannels(userId, accountId, []);
      return;
    }

    const channelIdsValue = body.channel_ids?.value;
    const channelIds = Array.isArray(channelIdsValue) ? channelIdsValue : [];

    await this.userService.updateUserChannels(userId, accountId, channelIds);
  }

  private async publishUserChannelsUpdate(
    userId: string,
    accountId: string
  ): Promise<void> {
    try {
      const channels = await this.userService.listUserChannelsWithNames(
        accountId,
        userId
      );

      await this.centrifugoService.publishSub(
        chatAccountCentrifugo(accountId),
        {
          event: 'user_channels_updated',
          user_id: userId,
          channels,
        }
      );
    } catch {
      // Best-effort: do not block user updates if realtime notification fails.
    }
  }

  private async validateUserExistsInAccount(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string
  ): Promise<void> {
    const userExists = await this.userService.existsUserById(userId, accountId);

    if (!userExists) {
      throw new Error(t('user_not_found'));
    }
  }

  private async validateUserExists(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<void> {
    const userAccountId = await this.userService.getUserAccountId(userId);

    if (!userAccountId) {
      throw new Error(t('user_not_found'));
    }
  }

  private async buildUpdatePromises(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<Promise<void>[]> {
    const updatePromises: Promise<void>[] = [];

    if (this.hasUserFields(body)) {
      await this.validateUserFields(t, body, userId);
      updatePromises.push(
        this.updateUserData(t, userId, body, accountId, canOperateOnOthers)
      );
    }

    if (this.hasUserInfoFields(body)) {
      await this.validateUserInfoFields(t, body, userId);
      updatePromises.push(
        this.updateUserInfoData(t, userId, body, accountId, canOperateOnOthers)
      );
    }

    if (this.hasUserDocumentFields(body)) {
      await this.validateUserDocumentFields(t, body);
      updatePromises.push(this.updateUserDocumentData(t, userId, body));
    }

    if (this.hasUserAddressFields(body)) {
      await this.validateUserAddressFields(t, body);
      updatePromises.push(this.updateUserAddressData(t, userId, body));
    }

    if (this.hasPermissionRoleIdField(body)) {
      updatePromises.push(
        this.updateUserRoleData(t, userId, body, accountId, canOperateOnOthers)
      );
    }

    if (this.hasSectorIdsField(body)) {
      updatePromises.push(this.updateUserSectorsData(t, userId, body));
    }

    if (this.hasChannelIdsField(body)) {
      updatePromises.push(this.updateUserChannelsData(t, userId, body));
    }

    return updatePromises;
  }

  private processSectorIdsFromMultipartFormData(body: any): void {
    if (
      body.sector_ids === 'null' ||
      body.sector_ids === null ||
      body.sector_ids === ''
    ) {
      body.sector_ids = { value: null };
      return;
    }

    const sectorIdsArray: string[] = [];

    Object.keys(body).forEach((key) => {
      const match = key.match(/^sector_ids\[(\d+)\]$/);
      if (!match) {
        return;
      }

      const index = parseInt(match[1], 10);
      const field = body[key];
      const value =
        typeof field === 'object' && field.value ? field.value : field;
      sectorIdsArray[index] = value;
    });

    if (sectorIdsArray.length > 0) {
      body.sector_ids = { value: sectorIdsArray.filter(Boolean) };
    }
  }

  private processChannelIdsFromMultipartFormData(body: any): void {
    if (
      body.channel_ids === 'null' ||
      body.channel_ids === null ||
      body.channel_ids === ''
    ) {
      body.channel_ids = { value: null };
      return;
    }

    const channelIdsArray: string[] = [];

    Object.keys(body).forEach((key) => {
      const match = key.match(/^channel_ids\[(\d+)\]$/);
      if (!match) {
        return;
      }

      const index = parseInt(match[1], 10);
      const field = body[key];
      const value =
        typeof field === 'object' && field.value ? field.value : field;
      channelIdsArray[index] = value;
    });

    if (channelIdsArray.length > 0) {
      body.channel_ids = { value: channelIdsArray.filter(Boolean) };
    }
  }

  private async sanitizePermissionRoleUpdateForProtectedUsers(
    userId: string,
    body: UpdateUserRequest,
    currentUserId?: string
  ): Promise<void> {
    if (body.permission_role_id === undefined) {
      return;
    }

    if (currentUserId && userId === currentUserId) {
      delete body.permission_role_id;
      return;
    }

    const targetUserRoleId = await this.userService.getUserRole(userId);

    if (targetUserRoleId === EPermissionRole.master) {
      delete body.permission_role_id;
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest,
    accountId: string,
    canOperateOnOthers: boolean,
    currentUserId?: string
  ): Promise<boolean> {
    this.processSectorIdsFromMultipartFormData(body);
    this.processChannelIdsFromMultipartFormData(body);

    if (!canOperateOnOthers) {
      await this.validateUserExistsInAccount(t, userId, accountId);
    }

    if (canOperateOnOthers) {
      await this.validateUserExists(t, userId);
    }

    await this.sanitizePermissionRoleUpdateForProtectedUsers(
      userId,
      body,
      currentUserId
    );

    const updatePromises = await this.buildUpdatePromises(
      t,
      userId,
      body,
      accountId,
      canOperateOnOthers
    );

    await Promise.all(updatePromises);

    if (body.channel_ids !== undefined) {
      const userAccountId =
        (await this.userService.getUserAccountId(userId)) ?? accountId;
      await this.publishUserChannelsUpdate(userId, userAccountId);
    }

    return true;
  }
}
