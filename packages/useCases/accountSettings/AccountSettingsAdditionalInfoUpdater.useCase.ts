import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { EncryptService } from '@core/services/encrypt.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { UpdateAdditionalInfoRequest } from '@core/schema/accountSettings/updateAdditionalInfo/request.schema';
import { UpdateAdditionalInfoResponse } from '@core/schema/accountSettings/updateAdditionalInfo/response.schema';
import { IUpdateUserInfo } from '@core/common/interfaces/IUpdateUserInfo';
import { IUpdateUserDocument } from '@core/common/interfaces/IUpdateUserDocument';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';

@injectable()
export class AccountSettingsAdditionalInfoUpdaterUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly encryptService: EncryptService,
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  private extractStringValue(field: string | null | undefined): string | null {
    const value = field ?? null;
    return value === '' ? null : value;
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

  private validateBirthDate(
    t: TFunction<'translation', undefined>,
    birthDate: string
  ): string | null {
    const date = new Date(birthDate);
    const now = new Date();

    if (isNaN(date.getTime())) {
      throw new Error(t('invalid_birth_date'));
    }

    if (date > now) {
      throw new Error(t('birth_date_cannot_be_future'));
    }

    return birthDate;
  }

  private buildUpdateUserInfoInput(
    t: TFunction<'translation', undefined>,
    body: UpdateAdditionalInfoRequest
  ): IUpdateUserInfo {
    const phoneValue = this.extractStringValue(body.phone);
    const phoneData = this.encryptPhoneData(phoneValue);
    const birthDateValue = this.extractStringValue(body.birth_date);
    const birthDate = birthDateValue
      ? this.validateBirthDate(t, birthDateValue)
      : null;

    return {
      phone_ddi: this.extractStringValue(body.phone_ddi),
      phone: phoneData.phoneCEncrypted,
      phone_partial: phoneData.phonePartialEncrypted,
      phone_c: phoneData.phoneC,
      name: this.extractStringValue(body.name),
      last_name: this.extractStringValue(body.last_name),
      birth_date: birthDate,
    };
  }

  private buildUpdateUserDocumentInput(
    body: UpdateAdditionalInfoRequest
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

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateAdditionalInfoRequest
  ): Promise<UpdateAdditionalInfoResponse> {
    const userInfo = this.buildUpdateUserInfoInput(t, body);
    const userDocument = this.buildUpdateUserDocumentInput(body);

    if (userInfo.phone_c) {
      await this.validatePhoneUniqueness(t, userInfo.phone_c, userId);
    }

    const hasUserInfoFields = Object.values(userInfo).some(
      (value) => value !== undefined
    );
    const hasUserDocumentFields = Object.values(userDocument).some(
      (value) => value !== undefined
    );

    if (hasUserInfoFields) {
      const updated = await this.userService.updateUserInfoById(
        userId,
        userInfo
      );

      if (!updated) {
        throw new Error(t('user_info_update_failed'));
      }
    }

    if (hasUserDocumentFields) {
      const updated = await this.userService.updateUserDocumentById(
        userId,
        userDocument
      );

      if (!updated) {
        throw new Error(t('user_document_update_failed'));
      }
    }

    return {
      success: true,
    };
  }
}
