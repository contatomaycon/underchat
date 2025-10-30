import { injectable } from 'tsyringe';
import { generalEnvironment } from '@core/config/environments';
import { FastifyReply, FastifyRequest } from 'fastify';
import { TFunction } from 'i18next';
import { RefreshTokenResponse } from '@core/schema/auth/refrehToken/response.schema';
import { ERouteModule } from '@core/common/enums/ERouteModule';

@injectable()
export class AuthRefreshTokenUseCase {
  constructor() {}

  async execute(
    t: TFunction<'translation', undefined>,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<RefreshTokenResponse> {
    const decodeToken: {
      user_id: string;
      module: ERouteModule;
    } = await request.jwtVerify({
      verify: {
        key: generalEnvironment.jwtSecret,
        ignoreExpiration: true,
      },
      decode: {
        complete: true,
      },
    });

    if (!decodeToken) {
      throw new Error(t('invalid_token'));
    }

    if (decodeToken.module !== request.module) {
      throw new Error(t('invalid_token_module'));
    }

    const payload = {
      user_id: decodeToken.user_id,
      module: request.module,
    };

    const token = await reply.jwtSign(payload, {
      sign: {
        expiresIn: generalEnvironment.jwtSecretExpiresIn,
        key: generalEnvironment.jwtSecret,
      },
    });

    return {
      token,
    };
  }
}
