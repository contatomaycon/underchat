import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ChangePasswordResponse } from '@core/schema/accountSettings/changePassword/response.schema';
import { ChangePasswordRequest } from '@core/schema/accountSettings/changePassword/request.schema';
import { validatePassword } from '@core/common/utils/passwordValidator';

@injectable()
export class AccountSettingsPasswordChangerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    body: ChangePasswordRequest
  ): Promise<ChangePasswordResponse> {
    const isValidCurrentPassword = await this.userService.verifyUserPassword(
      userId,
      accountId,
      body.current_password
    );

    if (!isValidCurrentPassword) {
      throw new Error(t('current_password_invalid'));
    }

    const passwordValidation = validatePassword(body.new_password);
    if (!passwordValidation.isValid) {
      const errorMessages = passwordValidation.errors.map((err) => t(err));
      throw new Error(errorMessages.join(', '));
    }

    await this.userService.updateUserPassword(
      t,
      userId,
      accountId,
      body.new_password
    );

    return {
      success: true,
    };
  }
}
