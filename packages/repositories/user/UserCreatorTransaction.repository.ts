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
import { SectorUserCreatorRepository } from '../sector/SectorUserCreator.repository';
import { UserChannelCreatorRepository } from './UserChannelCreator.repository';

@injectable()
export class UserTransactionCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly encryptService: EncryptService,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly userCreatorRepository: UserCreatorRepository,
    private readonly userAddressCreatorRepository: UserAddressCreatorRepository,
    private readonly userDocumentCreatorRepository: UserDocumentCreatorRepository,
    private readonly userInfoCreatorRepository: UserInfoCreatorRepository,
    private readonly userExistsByEmailAndPhoneRepository: UserExistsByEmailAndPhoneRepository,
    private readonly chatUserCreatorRepository: ChatUserCreatorRepository,
    private readonly permissionAssignmentCreatorRepository: PermissionAssignmentCreatorRepository,
    private readonly sectorUserCreatorRepository: SectorUserCreatorRepository,
    private readonly userChannelCreatorRepository: UserChannelCreatorRepository
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
    await this.dbRw.transaction(async (tx) => {
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

      const phoneC = input.phone?.value
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
        user_status_id: input.user_status_id?.value || undefined,
      };

      const createUserId = await this.userCreatorRepository.createUser(
        tx,
        createUserInput
      );

      if (!createUserId) {
        throw new Error(t('user_creation_failed'));
      }

      const createUserInfo: ICreateUserInfo = {
        phone_ddi: input.phone_ddi?.value ?? null,
        phone: null,
        phone_partial: null,
        phone_c: null,
        photo: photoUrl ?? null,
        name: input.name.value,
        last_name: input.last_name.value,
        birth_date: null,
      };

      if (input.phone?.value) {
        const phoneEncrypted = this.passwordEncryptorService.encrypt(
          input.phone.value
        );
        const phonePartialEncrypted = this.encryptService.sanitize(
          input.phone.value,
          ETypeSanetize.phone
        );

        createUserInfo.phone = phoneEncrypted;
        createUserInfo.phone_partial = phonePartialEncrypted;
        createUserInfo.phone_c = phoneC;
      }

      if (input.birth_date?.value) {
        createUserInfo.birth_date = this.validateBirthDate(
          t,
          input.birth_date.value
        );
      }

      const createUserAddress: ICreateUserAddress | null = input.country_id
        ? {
            country_id: input.country_id.value,
            zip_code: input.zip_code?.value ?? null,
            address1: null,
            address1_partial: null,
            address1_c: null,
            address2: null,
            address2_partial: null,
            address2_c: null,
            city_fiscal_code: input.city_fiscal_code?.value ?? null,
            state_fiscal_code: input.state_fiscal_code?.value ?? null,
            district: input.district?.value ?? null,
          }
        : null;

      if (input.address1?.value) {
        const addressEncrypted = this.passwordEncryptorService.encrypt(
          input.address1.value
        );
        const addressPartialEncrypted = this.encryptService.sanitize(
          input.address1.value,
          ETypeSanetize.other
        );
        const address1C = this.encryptService.encrypt(input.address1.value);

        if (createUserAddress) {
          createUserAddress.address1 = addressEncrypted;
          createUserAddress.address1_partial = addressPartialEncrypted;
          createUserAddress.address1_c = address1C;
        }
      }

      if (input.address2?.value) {
        const address2Encrypted = this.passwordEncryptorService.encrypt(
          input.address2.value
        );
        const address2PartialEncrypted = this.encryptService.sanitize(
          input.address2.value,
          ETypeSanetize.other
        );
        const address2C = this.encryptService.encrypt(input.address2.value);

        if (createUserAddress) {
          createUserAddress.address2 = address2Encrypted;
          createUserAddress.address2_partial = address2PartialEncrypted;
          createUserAddress.address2_c = address2C;
        }
      }

      const createUserDocument: ICreateUserDocument | null =
        input.document_type_id
          ? {
              user_document_type_id: input.document_type_id.value,
              document: null,
              document_partial: null,
              document_c: null,
            }
          : null;

      if (input.document?.value) {
        const documentEncrypted = this.passwordEncryptorService.encrypt(
          input.document.value
        );
        const documentPartialEncrypted = this.encryptService.sanitize(
          input.document.value,
          ETypeSanetize.document
        );
        const documentC = this.encryptService.encrypt(input.document.value);

        if (createUserDocument) {
          createUserDocument.document = documentEncrypted;
          createUserDocument.document_partial = documentPartialEncrypted;
          createUserDocument.document_c = documentC;
        }
      }

      const promises: Promise<any>[] = [
        this.userInfoCreatorRepository.createUserInfo(
          tx,
          createUserInfo,
          createUserId
        ),
        this.chatUserCreatorRepository.createChatUser(tx, createUserId),
      ];

      if (createUserAddress) {
        promises.push(
          this.userAddressCreatorRepository.createUserAddress(
            tx,
            createUserAddress,
            createUserId
          )
        );
      }

      if (createUserDocument) {
        promises.push(
          this.userDocumentCreatorRepository.createUserDocument(
            tx,
            createUserDocument,
            createUserId
          )
        );
      }

      const results = await Promise.all(promises);

      const userInfo = results[0];
      const chatUser = results[1];
      const userAddress = createUserAddress ? results[2] : true;
      const userDocument = createUserDocument
        ? results[createUserAddress ? 3 : 2]
        : true;

      if (!userInfo || !chatUser || !userAddress || !userDocument) {
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

      if (input.sector_ids && input.sector_ids.length > 0) {
        await Promise.all(
          input.sector_ids.map((sectorId) =>
            this.sectorUserCreatorRepository.createSectorUserInTransaction(
              tx,
              createUserId,
              sectorId
            )
          )
        );
      }

      if (input.channel_ids && input.channel_ids.length > 0) {
        await Promise.all(
          input.channel_ids.map((channelId) =>
            this.userChannelCreatorRepository.createUserChannelInTransaction(
              tx,
              createUserId,
              channelId,
              accountId
            )
          )
        );
      }
    });
    return true;
  };
}
