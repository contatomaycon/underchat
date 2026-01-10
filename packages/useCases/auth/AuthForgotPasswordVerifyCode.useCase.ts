import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AuthForgotPasswordVerifyCodeRequest } from '@core/schema/auth/forgotPassword/verifyCode/request.schema';
import { AuthForgotPasswordVerifyCodeResponse } from '@core/schema/auth/forgotPassword/verifyCode/response.schema';
import { TwoFactorService } from '@core/services/twoFactor.service';
import { FastifyReply } from 'fastify';
import { generalEnvironment } from '@core/config/environments';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { AccountService } from '@core/services/account.service';
import { AuthRepository } from '@core/repositories/auth/Auth.repository';

@injectable()
export class AuthForgotPasswordVerifyCodeUseCase {
  constructor(
    private readonly twoFactorService: TwoFactorService,
    private readonly authRepository: AuthRepository,
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    reply: FastifyReply,
    module: ERouteModule,
    input: AuthForgotPasswordVerifyCodeRequest
  ): Promise<AuthForgotPasswordVerifyCodeResponse> {
    const twoFactorData = await this.twoFactorService.findTwoFactorByCode(
      input.code.toUpperCase()
    );

    if (!twoFactorData?.created_at) {
      throw new Error(t('forgot_password_code_invalid'));
    }

    const createdAt = new Date(twoFactorData.created_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);

    if (diffMinutes > 30) {
      throw new Error(t('forgot_password_code_expired'));
    }

    if (!twoFactorData.email_c || !twoFactorData.user_id) {
      throw new Error(t('forgot_password_code_invalid'));
    }

    const deletedAt = new Date().toISOString();
    await this.twoFactorService.updateDeletedAt(
      twoFactorData.two_factor_id,
      deletedAt
    );

    const userResult = await this.authRepository.findUserById(
      twoFactorData.user_id
    );

    if (!userResult) {
      throw new Error(t('forgot_password_user_not_found'));
    }

    const isAccountBlocked = await this.accountService.isAccountBlocked(
      userResult.account_id
    );

    if (isAccountBlocked) {
      throw new Error(t('account_blocked_contact_support'));
    }

    const token = await reply.jwtSign(
      {
        user_id: userResult.user_id,
        module,
        account_id: userResult.account_id,
        forgot_password: true,
      },
      {
        sign: {
          expiresIn: generalEnvironment.jwtSecretExpiresIn,
          key: generalEnvironment.jwtSecret,
        },
      }
    );

    return {
      token,
      user_id: userResult.user_id,
      account_id: userResult.account_id,
    };
  }
}
