import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { EncryptService } from '@core/services/encrypt.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { UpdateAddressRequest } from '@core/schema/accountSettings/updateAddress/request.schema';
import { UpdateAddressResponse } from '@core/schema/accountSettings/updateAddress/response.schema';
import { IUpdateUserAddress } from '@core/common/interfaces/IUpdateUserAddress';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';

@injectable()
export class AccountSettingsAddressUpdaterUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly encryptService: EncryptService,
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  private extractStringValue(field: string | null | undefined): string | null {
    const value = field ?? null;
    return value === '' ? null : value;
  }

  private extractNumberValue(field: number | null | undefined): number | null {
    const value = field ?? null;
    return value;
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

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    body: UpdateAddressRequest
  ): Promise<UpdateAddressResponse> {
    const userAddress = this.buildUpdateUserAddressInput(body);

    const hasFields = Object.values(userAddress).some(
      (value) => value !== undefined
    );

    if (!hasFields) {
      return {
        success: true,
      };
    }

    const updated = await this.userService.updateUserAddressById(
      userId,
      userAddress
    );

    if (!updated) {
      throw new Error(t('user_address_update_failed'));
    }

    return {
      success: true,
    };
  }
}
