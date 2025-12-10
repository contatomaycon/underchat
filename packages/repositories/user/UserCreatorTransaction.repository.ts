import * as schema from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { CreateUserRequest } from '@core/schema/user/createUser/request.schema';
import { EncryptService } from '@core/services/encrypt.service';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { ICreateUser } from '@core/common/interfaces/ICreateUser';
import { UserCreatorRepository } from './UserCreator.repository';
import { ICreateUserAddress } from '@core/common/interfaces/ICreateUserAddress';
import { UserAddressCreatorRepository } from './UserAddressCreator.repository';
import { ICreateUserDocument } from '@core/common/interfaces/ICreateUserDocument';
import { UserDocumentCreatorRepository } from './UserDocumentCreator.repository';
import { ICreateUserInfo } from '@core/common/interfaces/ICreateUserInfo';
import { UserInfoCreatorRepository } from './UserInfoCreator.repository';
import { UserExistsByEmailAndPhoneRepository } from './UserExistsByEmailAndPhone.repository';
import moment from 'moment';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { ChatUserCreatorRepository } from '../chat/ChatUserCreator.repository';
import { PermissionAssignmentCreatorRepository } from '../permission/PermissionAssignmentCreator.repository';

@injectable()
export class UserTransactionCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    private readonly encryptService: EncryptService,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly userCreatorRepository: UserCreatorRepository,
    private readonly userAddressCreatorRepository: UserAddressCreatorRepository,
    private readonly userDocumentCreatorRepository: UserDocumentCreatorRepository,
    private readonly userInfoCreatorRepository: UserInfoCreatorRepository,
    private readonly userExistsByEmailAndPhoneRepository: UserExistsByEmailAndPhoneRepository,
    private readonly chatUserCreatorRepository: ChatUserCreatorRepository,
    private readonly permissionAssignmentCreatorRepository: PermissionAssignmentCreatorRepository
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

  createUser = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateUserRequest,
    photoUrl?: string | null
  ): Promise<boolean> => {
    await this.db.transaction(async (tx) => {
      if (!input.email?.value || !input.password?.value) {
        throw new Error(t('email_required'));
      }

      const emailCEncrypted = this.passwordEncryptorService.encrypt(
        input.email.value
      );

      const emailPartialEncrypted = this.encryptService.sanitize(
        input.email.value,
        ETypeSanetize.email
      );
      const emailC = this.encryptService.encrypt(input.email.value);
      const passwordEncrypted = this.encryptService.encrypt(
        input.password.value
      );

      const phoneC = input.phone.value
        ? this.encryptService.encrypt(input.phone.value)
        : null;

      const [emailExists, phoneExists] = await Promise.all([
        this.userExistsByEmailAndPhoneRepository.existsUserByEmail(emailC),
        phoneC
          ? this.userExistsByEmailAndPhoneRepository.existsUserByPhone(phoneC)
          : Promise.resolve(false),
      ]);

      if (emailExists) {
        throw new Error(t('user_already_exists_email'));
      }

      if (phoneExists) {
        throw new Error(t('user_already_exists_phone'));
      }

      const createUserInput: ICreateUser = {
        account_id: accountId,
        email: emailCEncrypted,
        email_partial: emailPartialEncrypted,
        email_c: emailC,
        password: passwordEncrypted,
      };

      const createUserId = await this.userCreatorRepository.createUser(
        tx,
        createUserInput
      );

      if (!createUserId) {
        throw new Error(t('user_creation_failed'));
      }

      const addressEncrypted = this.passwordEncryptorService.encrypt(
        input.address1.value
      );
      const addressPartialEncrypted = this.encryptService.sanitize(
        input.address1.value,
        ETypeSanetize.other
      );
      const address1C = this.encryptService.encrypt(input.address1.value);

      const address2Encrypted = input.address2?.value
        ? this.passwordEncryptorService.encrypt(input.address2.value)
        : null;
      const address2PartialEncrypted = input.address2?.value
        ? this.encryptService.sanitize(
            input.address2.value,
            ETypeSanetize.other
          )
        : null;
      const address2C = input.address2?.value
        ? this.encryptService.encrypt(input.address2.value)
        : null;

      const createUserAddress: ICreateUserAddress = {
        country_id: input.country_id.value,
        zip_code: input.zip_code.value,
        address1: addressEncrypted,
        address1_partial: addressPartialEncrypted,
        address1_c: address1C,
        address2: address2Encrypted,
        address2_partial: address2PartialEncrypted,
        address2_c: address2C,
        city_fiscal_code: input.city_fiscal_code?.value ?? null,
        state_fiscal_code: input.state_fiscal_code?.value ?? null,
        district: input.district.value,
      };

      const documentEncrypted = this.passwordEncryptorService.encrypt(
        input.document.value
      );
      const documentPartialEncrypted = this.encryptService.sanitize(
        input.document.value,
        ETypeSanetize.document
      );
      const documentC = this.encryptService.encrypt(input.document.value);

      const createUserDocument: ICreateUserDocument = {
        user_document_type_id: input.document_type_id.value,
        document: documentEncrypted,
        document_partial: documentPartialEncrypted,
        document_c: documentC,
      };

      if (!phoneC) {
        throw new Error(t('phone_connection_required'));
      }

      const phoneEncrypted = this.passwordEncryptorService.encrypt(
        input.phone.value
      );

      const phonePartialEncrypted = this.encryptService.sanitize(
        input.phone.value,
        ETypeSanetize.phone
      );

      const birthDate = input.birth_date?.value
        ? this.validateBirthDate(t, input.birth_date.value)
        : null;

      const createUserInfo: ICreateUserInfo = {
        phone_ddi: input.phone_ddi.value,
        phone: phoneEncrypted,
        phone_partial: phonePartialEncrypted,
        phone_c: phoneC,
        photo: photoUrl ?? null,
        name: input.name.value,
        last_name: input.last_name.value,
        birth_date: birthDate ?? null,
      };

      const [userAddress, userDocument, userInfo, chatUser] = await Promise.all(
        [
          this.userAddressCreatorRepository.createUserAddress(
            tx,
            createUserAddress,
            createUserId
          ),
          this.userDocumentCreatorRepository.createUserDocument(
            tx,
            createUserDocument,
            createUserId
          ),
          this.userInfoCreatorRepository.createUserInfo(
            tx,
            createUserInfo,
            createUserId
          ),
          this.chatUserCreatorRepository.createChatUser(tx, createUserId),
        ]
      );

      if (!userAddress || !userDocument || !userInfo || !chatUser) {
        throw new Error('user_creation_failed');
      }

      if (input.permission_role_id?.value) {
        const permissionAssignmentId =
          await this.permissionAssignmentCreatorRepository.createPermissionAssignmentInTransaction(
            tx,
            createUserId,
            input.permission_role_id.value,
            accountId
          );

        if (!permissionAssignmentId) {
          throw new Error(t('user_role_assignment_failed'));
        }
      }
    });
    return true;
  };
}
