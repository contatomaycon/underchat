import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AuthRegisterSendTwoFactorRequest } from '@core/schema/register/sendTwoFactor/request.schema';
import { AccountTestService } from '@core/services/accountTest.service';
import { UserService } from '@core/services/user.service';
import { NotificationMessageService } from '@core/services/notificationMessage.service';
import { EncryptService } from '@core/services/encrypt.service';

@injectable()
export class AuthRegisterSendTwoFactorUseCase {
  constructor(
    @inject(AccountTestService)
    private readonly accountTestService: AccountTestService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(NotificationMessageService)
    private readonly notificationMessageService: NotificationMessageService,
    @inject(EncryptService)
    private readonly encryptService: EncryptService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: AuthRegisterSendTwoFactorRequest
  ): Promise<void> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const phoneNumber = input.phone.replaceAll(/\D/g, '');
    const phoneDDD = input.phone_ddd?.replaceAll(/\D/g, '') || '';
    const phoneDDI = input.phone_ddi.replaceAll(/\D/g, '');
    const fullPhone = phoneDDD ? `${phoneDDD}${phoneNumber}` : phoneNumber;

    const existingTestByPhone =
      await this.accountTestService.checkExistingTestByPhone(fullPhone);

    if (existingTestByPhone) {
      throw new Error(t('register_phone_already_used_in_test'));
    }

    const emailC = this.encryptService.encrypt(normalizedEmail);
    const existingTestByEmail =
      await this.accountTestService.checkExistingTestByEmail(normalizedEmail);

    if (existingTestByEmail) {
      throw new Error(t('register_email_already_used_in_test'));
    }

    const existingUserByEmail =
      await this.userService.existsUserByEmail(emailC);

    if (existingUserByEmail) {
      throw new Error(t('register_email_already_used'));
    }

    const phoneC = this.encryptService.encrypt(fullPhone);
    const existingUserByPhone =
      await this.userService.existsUserByPhone(phoneC);

    if (existingUserByPhone) {
      throw new Error(t('register_phone_already_used'));
    }

    await this.notificationMessageService.sendTwoFactorCodeByWhatsApp(
      fullPhone,
      phoneDDI,
      input.name,
      normalizedEmail
    );
  }
}
