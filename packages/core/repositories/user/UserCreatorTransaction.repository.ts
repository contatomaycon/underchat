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
import moment from 'moment';

@injectable()
export class UserTransactionCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    private readonly encryptService: EncryptService,
    private readonly userCreatorRepository: UserCreatorRepository,
    private readonly userAddressCreatorRepository: UserAddressCreatorRepository,
    private readonly userDocumentCreatorRepository: UserDocumentCreatorRepository,
    private readonly userInfoCreatorRepository: UserInfoCreatorRepository
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
    input: CreateUserRequest
  ): Promise<boolean> => {
    await this.db.transaction(async (tx) => {
      const emailCEncrypted = this.encryptService.encrypt(input.email);
      const emailPartialEncrypted = this.encryptService.sanitize(
        input.email,
        ETypeSanetize.email
      );
      const passwordEncrypted = this.encryptService.encrypt(input.password);

      const createUserInput: ICreateUser = {
        account_id: accountId,
        username: input.username,
        email: emailCEncrypted,
        email_partial: emailPartialEncrypted,
        password: passwordEncrypted,
      };

      const createUserId = await this.userCreatorRepository.createUser(
        tx,
        createUserInput
      );

      if (!createUserId) {
        throw new Error(t('user_creation_failed'));
      }

      const addressEncrypted = this.encryptService.encrypt(
        input.user_address?.address1
      );
      const addressPartialEncrypted = this.encryptService.sanitize(
        input.user_address?.address1,
        ETypeSanetize.other
      );

      const address2Encrypted = input.user_address?.address2
        ? this.encryptService.encrypt(input.user_address?.address2)
        : null;
      const address2PartialEncrypted = input.user_address?.address2
        ? this.encryptService.sanitize(
            input.user_address?.address2,
            ETypeSanetize.other
          )
        : null;

      const createUserAddress: ICreateUserAddress = {
        country_id: input.user_address?.country_id,
        zip_code: input.user_address?.zip_code,
        address1: addressEncrypted,
        address1_partial: addressPartialEncrypted,
        address2: address2Encrypted,
        address2_partial: address2PartialEncrypted,
        city: input.user_address?.city,
        state: input.user_address?.state,
        district: input.user_address?.district,
      };

      const documentEncrypted = this.encryptService.encrypt(
        input.user_document?.document
      );
      const documentPartialEncrypted = this.encryptService.sanitize(
        input.user_document?.document,
        ETypeSanetize.document
      );

      const createUserDocument: ICreateUserDocument = {
        user_document_type_id: input.user_document?.user_document_type_id,
        document: documentEncrypted,
        document_partial: documentPartialEncrypted,
      };

      const phoneEncrypted = this.encryptService.encrypt(
        input.user_info?.phone
      );

      const phonePartialEncrypted = this.encryptService.sanitize(
        input.user_info?.phone,
        ETypeSanetize.phone
      );

      const birthDate = input.user_info?.birth_date
        ? this.validateBirthDate(t, input.user_info.birth_date)
        : null;

      const createUserInfo: ICreateUserInfo = {
        phone_ddi: input.user_info?.phone_ddi,
        phone: phoneEncrypted,
        phone_partial: phonePartialEncrypted,
        name: input.user_info?.name,
        last_name: input.user_info?.last_name,
        birth_date: birthDate ?? null,
      };

      const [userAddress, userDocument, userInfo] = await Promise.all([
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
      ]);

      if (!userAddress || !userDocument || !userInfo) {
        throw new Error('user_creation_failed');
      }
    });
    return true;
  };
}
