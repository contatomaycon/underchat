import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AuthRegisterSendTwoFactorRequest } from '@core/schema/register/sendTwoFactor/request.schema';
import { AccountTestService } from '@core/services/accountTest.service';
import { UserService } from '@core/services/user.service';
import { NotificationMessageService } from '@core/services/notificationMessage.service';
import { EncryptService } from '@core/services/encrypt.service';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';

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

  private buildPhoneCandidates(phone: string, phoneDdi: string): string[] {
    return buildCandidatesWithDdi(phone, phoneDdi, { order: 'input_first' });
  }

  private async hasExistingTestByAnyPhone(phoneCandidates: string[]) {
    const checks = await Promise.all(
      phoneCandidates.map((phone) =>
        this.accountTestService.checkExistingTestByPhone(phone)
      )
    );

    return checks.some(Boolean);
  }

  private async hasExistingUserByAnyPhone(phoneCandidates: string[]) {
    const checks = await Promise.all(
      phoneCandidates.map((phone) =>
        this.userService.existsUserByPhone(this.encryptService.encrypt(phone))
      )
    );

    return checks.some(Boolean);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: AuthRegisterSendTwoFactorRequest
  ): Promise<void> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const phoneNumber = input.phone.replaceAll(/\D/g, '');
    const phoneDDD = input.phone_ddd?.replaceAll(/\D/g, '') || '';
    const phoneDDI = input.phone_ddi.replaceAll(/\D/g, '');
    const fullPhone = phoneDDD ? `${phoneDDD}${phoneNumber}` : phoneNumber;
    const phoneCandidates = this.buildPhoneCandidates(fullPhone, phoneDDI);

    const existingTestByPhone =
      await this.hasExistingTestByAnyPhone(phoneCandidates);

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

    const existingUserByPhone =
      await this.hasExistingUserByAnyPhone(phoneCandidates);

    if (existingUserByPhone) {
      throw new Error(t('register_phone_already_used'));
    }

    await this.notificationMessageService.sendTwoFactorCodeWithChannels({
      email: normalizedEmail,
      userId: null,
      phone: fullPhone,
      phoneDdi: phoneDDI,
      name: input.name,
    });
  }
}
