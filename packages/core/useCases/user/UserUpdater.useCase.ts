import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateUserRequest } from '@core/schema/user/editUser/request.schema';
import { UserService } from '@core/services/user.service';
import { EncryptService } from '@core/services/encrypt.service';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { IUpdateUser } from '@core/common/interfaces/IUpdateUser';
import { IUpdateUserInfo } from '@core/common/interfaces/IUpdateUserInfo';
import moment from 'moment';
import { IUpdateUserDocument } from '@core/common/interfaces/IUpdateUserDocument';
import { IUpdateUserAddress } from '@core/common/interfaces/IUpdateUserAddress';
import { CountryService } from '@core/services/country.service';

@injectable()
export class UserUpdaterUseCase {
  constructor(
    private readonly encryptService: EncryptService,
    private readonly userService: UserService,
    private readonly CountryService: CountryService
  ) {}

  private validateBirthDate(
    t: TFunction<'translation', undefined>,
    birthDate: string
  ) {
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

  async insertUser(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest,
    accountId: string
  ): Promise<void> {
    if (body.user_status_id) {
      const userStatusExists = await this.userService.existsUserStatusById(
        body.user_status_id
      );
      if (!userStatusExists) {
        throw new Error(t('user_status_not_found'));
      }
    }

    const emailCEncrypted = body.email
      ? this.encryptService.encrypt(body.email)
      : null;

    const emailPartialEncrypted = body.email
      ? this.encryptService.sanitize(body.email, ETypeSanetize.email)
      : null;

    const passwordEncrypted = body.password
      ? this.encryptService.encrypt(body.password)
      : null;

    const createUserInput: IUpdateUser = {
      user_status_id: body.user_status_id ?? null,
      username: body.username ?? null,
      email: emailCEncrypted,
      email_partial: emailPartialEncrypted,
      password: passwordEncrypted,
    };

    const updateUser = await this.userService.updateUserById(
      userId,
      createUserInput,
      accountId
    );

    if (!updateUser) {
      throw new Error(t('user_update_failed'));
    }
  }

  async insertUserInfo(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest
  ): Promise<void> {
    const phoneCEncrypted = body.user_info?.phone
      ? this.encryptService.encrypt(body.user_info.phone)
      : null;

    const phonePartialEncrypted = body.user_info?.phone
      ? this.encryptService.sanitize(body.user_info.phone, ETypeSanetize.phone)
      : null;

    const birthDate = body.user_info?.birth_date
      ? this.validateBirthDate(t, body.user_info.birth_date)
      : null;

    const userInfo: IUpdateUserInfo = {
      phone_ddi: body.user_info?.phone_ddi ?? null,
      phone: phoneCEncrypted,
      phone_partial: phonePartialEncrypted,
      name: body.user_info?.name ?? null,
      last_name: body.user_info?.last_name ?? null,
      birth_date: birthDate ?? null,
    };

    const updateUserInfo = await this.userService.updateUserInfoById(
      userId,
      userInfo
    );

    if (!updateUserInfo) {
      throw new Error(t('user_info_update_failed'));
    }
  }

  async insertUserDocument(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest
  ): Promise<void> {
    if (body.user_document?.user_document_type_id) {
      const userDocumentTypeExists =
        await this.userService.existsUserDocumentTypeById(
          body.user_document.user_document_type_id
        );
      if (!userDocumentTypeExists) {
        throw new Error(t('user_document_type_not_found'));
      }
    }

    const documentCEncrypted = body.user_document?.document
      ? this.encryptService.encrypt(body.user_document.document)
      : null;

    const documentPartialEncrypted = body.user_document?.document
      ? this.encryptService.sanitize(
          body.user_document.document,
          ETypeSanetize.document
        )
      : null;

    const userDocument: IUpdateUserDocument = {
      user_document_type_id: body.user_document?.user_document_type_id ?? null,
      document: documentCEncrypted,
      document_partial: documentPartialEncrypted,
    };

    const updateUserDocument = await this.userService.updateUserDocumentById(
      userId,
      userDocument
    );

    if (!updateUserDocument) {
      throw new Error(t('user_document_update_failed'));
    }
  }

  async insertUserAddress(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateUserRequest
  ): Promise<void> {
    if (body.user_address?.country_id) {
      const countryExists = await this.CountryService.existsCountryById(
        body.user_address.country_id
      );
      if (!countryExists) {
        throw new Error(t('country_not_found'));
      }
    }

    const address1CEncrypted = body.user_address?.address1
      ? this.encryptService.encrypt(body.user_address.address1)
      : null;

    const address1PartialEncrypted = body.user_address?.address1
      ? this.encryptService.sanitize(
          body.user_address.address1,
          ETypeSanetize.other
        )
      : null;

    const address2CEncrypted = body.user_address?.address2
      ? this.encryptService.encrypt(body.user_address.address2)
      : null;

    const address2PartialEncrypted = body.user_address?.address2
      ? this.encryptService.sanitize(
          body.user_address.address2,
          ETypeSanetize.other
        )
      : null;

    const userAddress: IUpdateUserAddress = {
      country_id: body.user_address?.country_id ?? null,
      zip_code: body.user_address?.zip_code ?? null,
      address1: address1CEncrypted,
      address1_partial: address1PartialEncrypted,
      address2: address2CEncrypted,
      address2_partial: address2PartialEncrypted,
      city: body.user_address?.city ?? null,
      state: body.user_address?.state ?? null,
      district: body.user_address?.district ?? null,
    };

    const updateUserAddress = await this.userService.updateUserAddressById(
      userId,
      userAddress
    );

    if (!updateUserAddress) {
      throw new Error(t('user_address_update_failed'));
    }
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

    if (body.email || body.password || body.username || body.user_status_id) {
      await this.insertUser(t, userId, body, accountId);
    }

    if (body.user_info) {
      await this.insertUserInfo(t, userId, body);
    }

    if (body.user_document) {
      await this.insertUserDocument(t, userId, body);
    }

    if (body.user_address) {
      await this.insertUserAddress(t, userId, body);
    }

    return true;
  }
}
