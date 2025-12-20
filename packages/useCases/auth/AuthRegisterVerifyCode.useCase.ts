import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AuthRegisterVerifyCodeRequest } from '@core/schema/register/verifyCode/request.schema';
import { TwoFactorService } from '@core/services/twoFactor.service';
import { FastifyReply } from 'fastify';
import { generalEnvironment } from '@core/config/environments';

@injectable()
export class AuthRegisterVerifyCodeUseCase {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    reply: FastifyReply,
    input: AuthRegisterVerifyCodeRequest
  ): Promise<string> {
    const twoFactorData = await this.twoFactorService.findTwoFactorByCode(
      input.code.toUpperCase()
    );

    if (!twoFactorData?.created_at) {
      throw new Error(t('register_code_invalid'));
    }

    const createdAt = new Date(twoFactorData.created_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);

    if (diffMinutes > 30) {
      throw new Error(t('register_code_expired'));
    }

    const deletedAt = new Date().toISOString();
    await this.twoFactorService.updateDeletedAt(
      twoFactorData.two_factor_id,
      deletedAt
    );

    const token = await reply.jwtSign(
      {
        token: twoFactorData.token,
        email_c: twoFactorData.email_c,
        phone_c: twoFactorData.phone_c,
      },
      {
        sign: {
          expiresIn: '30m',
          key: generalEnvironment.jwtSecret,
        },
      }
    );

    return token;
  }
}
