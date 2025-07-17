import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { generalEnvironment } from '@core/config/environments';
import { AuthLoginRequest } from '@core/schema/auth/login/request.schema';
import { AuthLoginUseCase } from '@core/useCases/auth/AuthLogin.useCase';

export const login = async (
  request: FastifyRequest<{
    Body: AuthLoginRequest;
  }>,
  reply: FastifyReply
) => {
  const loginAuthUseCase = container.resolve(AuthLoginUseCase);
  const { login, password } = request.body;
  const { t } = request;

  try {
    const responseAuth = await loginAuthUseCase.execute({
      login,
      password,
    });

    if (responseAuth) {
      const token = await reply.jwtSign(
        {
          user_id: responseAuth.user_id,
          module: request.module,
        },
        {
          sign: {
            expiresIn: generalEnvironment.jwtSecretExpiresIn,
            key: generalEnvironment.jwtSecret,
          },
        }
      );

      return sendResponse(reply, {
        message: t('login_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: {
          result: responseAuth,
          token,
        },
      });
    }

    request.server.logger.info(responseAuth, request.id);

    return sendResponse(reply, {
      message: t('login_invalid'),
      httpStatusCode: EHTTPStatusCode.unauthorized,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('login_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
