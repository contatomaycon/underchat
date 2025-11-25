import { injectable } from 'tsyringe';
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
import { CountryService } from '@core/services/country.service';
import { AccountService } from '@core/services/account.service';
import { StorageService } from '@core/services/storage.service';

@injectable()
export class UserUpdaterUseCase {
  constructor(
    private readonly encryptService: EncryptService,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly userService: UserService,
    private readonly CountryService: CountryService,
    private readonly accountService: AccountService,
    private readonly storageService: StorageService
  ) {}

  private extractStringValue(
    field: { value: string | null } | null | undefined
  ): string | null {
    return field?.value ?? null;
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
      await this.CountryService.existsCountryById(countryIdValue);

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

  private buildUpdateUserInput(body: UpdateUserRequest): IUpdateUser {
    const emailData = this.encryptEmailData(body.email);
    const passwordValue = this.extractStringValue(body.password);
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
    body: UpdateUserRequest
  ): IUpdateUserInfo {
    const phoneValue = this.extractStringValue(body.phone);
    const phoneData = this.encryptPhoneData(phoneValue);
    const birthDateValue = this.extractStringValue(body.birth_date);
    const birthDate = birthDateValue
      ? this.validateBirthDate(t, birthDateValue)
      : null;
    const photoUrlValue = this.extractStringValue(body.photo_url);

    return {
      phone_ddi: this.extractStringValue(body.phone_ddi),
      phone: phoneData.phoneCEncrypted,
      phone_partial: phoneData.phonePartialEncrypted,
      phone_c: phoneData.phoneC,
      name: this.extractStringValue(body.name),
      last_name: this.extractStringValue(body.last_name),
      birth_date: birthDate,
      photo: photoUrlValue,
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
      city: this.extractStringValue(body.city),
      state: this.extractStringValue(body.state),
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

  private async updateUserData(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest,
    accountId: string
  ): Promise<void> {
    const currentAccountId =
      (await this.userService.getUserAccountId(userId)) ?? null;
    const accountIdForUpdate = currentAccountId ?? accountId ?? null;

    if (!accountIdForUpdate) {
      throw new Error(t('account_not_found'));
    }

    const updateUserInput = this.buildUpdateUserInput(body);
    const accountIdValue = this.extractStringValue(body.account_id);
    const hasAccountChange =
      accountIdValue && currentAccountId && accountIdValue !== currentAccountId;

    if (hasAccountChange && accountIdValue) {
      updateUserInput.account_id = accountIdValue;

      await this.userService.updateUserByIdWithAccountChange(
        t,
        userId,
        updateUserInput,
        accountIdValue,
        currentAccountId
      );
      return;
    }

    const updateUser = await this.userService.updateUserById(
      userId,
      updateUserInput,
      accountIdForUpdate
    );

    if (!updateUser) {
      throw new Error(t('user_update_failed'));
    }
  }

  private async updateUserInfoData(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest
  ): Promise<void> {
    const photoUrlValue = this.extractStringValue(body.photo_url);

    if (photoUrlValue === null) {
      await this.deleteUserPhotoFromStorage(userId);
    }

    const userInfo = this.buildUpdateUserInfoInput(t, body);
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
    return !!(
      body.phone_ddi?.value ||
      body.phone?.value ||
      body.name?.value ||
      body.last_name?.value ||
      body.birth_date?.value ||
      body.photo_url !== undefined
    );
  }

  private hasUserDocumentFields(body: UpdateUserRequest): boolean {
    return !!(body.document_type_id?.value || body.document?.value);
  }

  private hasUserAddressFields(body: UpdateUserRequest): boolean {
    return !!(
      body.country_id?.value ||
      body.zip_code?.value ||
      body.address1?.value ||
      body.address2?.value ||
      body.city?.value ||
      body.state?.value ||
      body.district?.value
    );
  }

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> {
    const userExists = await this.userService.existsUserById(
      userId,
      accountId,
      isAdministrator
    );

    if (!userExists) {
      throw new Error(t('user_not_found'));
    }

    const updatePromises: Promise<void>[] = [];

    if (this.hasUserFields(body)) {
      await this.validateUserFields(t, body, userId);
      updatePromises.push(this.updateUserData(t, userId, body, accountId));
    }

    if (this.hasUserInfoFields(body)) {
      await this.validateUserInfoFields(t, body, userId);
      updatePromises.push(this.updateUserInfoData(t, userId, body));
    }

    if (this.hasUserDocumentFields(body)) {
      await this.validateUserDocumentFields(t, body);
      updatePromises.push(this.updateUserDocumentData(t, userId, body));
    }

    if (this.hasUserAddressFields(body)) {
      await this.validateUserAddressFields(t, body);
      updatePromises.push(this.updateUserAddressData(t, userId, body));
    }

    await Promise.all(updatePromises);

    return true;
  }
}
