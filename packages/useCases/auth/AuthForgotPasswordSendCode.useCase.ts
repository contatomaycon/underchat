import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AuthForgotPasswordSendCodeRequest } from '@core/schema/auth/forgotPassword/sendCode/request.schema';
import { AuthForgotPasswordSendCodeResponse } from '@core/schema/auth/forgotPassword/sendCode/response.schema';
import { NotificationMessageService } from '@core/services/notificationMessage.service';
import { EncryptService } from '@core/services/encrypt.service';
import { UserService } from '@core/services/user.service';

@injectable()
export class AuthForgotPasswordSendCodeUseCase {
  constructor(
    private readonly notificationMessageService: NotificationMessageService,
    private readonly encryptService: EncryptService,
    private readonly userService: UserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: AuthForgotPasswordSendCodeRequest
  ): Promise<AuthForgotPasswordSendCodeResponse> {
    const emailC = this.encryptService.encrypt(input.email);

    const userData =
      await this.userService.findUserByEmailForForgotPassword(emailC);

    if (!userData) {
      throw new Error(t('forgot_password_user_not_found'));
    }

    const decryptedEmail = this.userService.getUserEmailDecrypted(
      userData.email
    );

    if (!decryptedEmail) {
      throw new Error(t('forgot_password_user_not_found'));
    }

    const decryptedPhone = this.userService.getUserPhoneDecrypted(
      userData.phone
    );

    const result =
      await this.notificationMessageService.sendTwoFactorCodeByEmailWithChannels(
        decryptedEmail,
        userData.user_id,
        decryptedPhone ?? null,
        userData.phone_ddi ?? null,
        userData.name
      );

    return {
      success: true,
      message: t('forgot_password_code_sent'),
      sent_via_email: result.sent_via_email,
      sent_via_whatsapp: result.sent_via_whatsapp,
    };
  }
}
