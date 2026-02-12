import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { EncryptService } from '@core/services/encrypt.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { UpdateAddressRequest } from '@core/schema/accountSettings/updateAddress/request.schema';
import { UpdateAddressResponse } from '@core/schema/accountSettings/updateAddress/response.schema';
import { IUpdateUserAddress } from '@core/common/interfaces/IUpdateUserAddress';
import { ICreateUserAddress } from '@core/common/interfaces/ICreateUserAddress';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';

@injectable()
export class AccountSettingsAddressUpdaterUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService,
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  private extractStringValue(
    field: string | null | undefined = null
  ): string | null {
    const normalized = field ?? null;
    return normalized === '' ? null : normalized;
  }

  private extractNumberValue(
    field: number | null | undefined = null
  ): number | null {
    if (field === null || field === undefined || field === 0) {
      return null;
    }

    return field;
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

  private buildUpdateUserAddressInput(
    body: UpdateAddressRequest
  ): IUpdateUserAddress {
    const input: IUpdateUserAddress = {};

    if (body.country_id !== undefined) {
      if (body.country_id !== null && body.country_id !== 0) {
        input.country_id = body.country_id;
      }
    }

    if (body.zip_code !== undefined) {
      input.zip_code = this.extractStringValue(body.zip_code);
    }

    if (body.address1 !== undefined) {
      const address1Value = this.extractStringValue(body.address1);
      const address1Data = this.encryptAddressData(address1Value);
      input.address1 = address1Data.addressCEncrypted;
      input.address1_partial = address1Data.addressPartialEncrypted;
      input.address1_c = address1Data.addressC;
    }

    if (body.address2 !== undefined) {
      const address2Value = this.extractStringValue(body.address2);
      const address2Data = this.encryptAddressData(address2Value);
      input.address2 = address2Data.addressCEncrypted;
      input.address2_partial = address2Data.addressPartialEncrypted;
      input.address2_c = address2Data.addressC;
    }

    if (body.city_fiscal_code !== undefined) {
      input.city_fiscal_code = this.extractStringValue(body.city_fiscal_code);
    }

    if (body.state_fiscal_code !== undefined) {
      input.state_fiscal_code = this.extractStringValue(body.state_fiscal_code);
    }

    if (body.district !== undefined) {
      input.district = this.extractStringValue(body.district);
    }

    return input;
  }

  private buildCreateUserAddressInput(
    body: UpdateAddressRequest
  ): ICreateUserAddress {
    const address1Value = this.extractStringValue(body.address1);
    const address2Value = this.extractStringValue(body.address2);
    const address1Data = this.encryptAddressData(address1Value);
    const address2Data = this.encryptAddressData(address2Value);
    const countryIdValue = this.extractNumberValue(body.country_id);

    if (countryIdValue === null || countryIdValue === undefined) {
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

  private async updateUserAddressData(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateAddressRequest
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
    const hasFieldsToUpdate = Object.keys(userAddress).length > 0;

    if (!hasFieldsToUpdate) {
      return;
    }

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
    body: UpdateAddressRequest
  ): Promise<UpdateAddressResponse> {
    await this.updateUserAddressData(t, userId, body);

    return {
      success: true,
    };
  }
}
