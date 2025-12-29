import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AuthLoginRequest } from '@core/schema/auth/login/request.schema';
import { AuthLoginUseCase } from '@core/useCases/auth/AuthLogin.useCase';

export const login = async (
  request: FastifyRequest<{
    Body: AuthLoginRequest;
  }>,
  reply: FastifyReply
) => {
  const loginAuthUseCase = container.resolve(AuthLoginUseCase);
  const { t } = request;

  try {
    const responseAuth = await loginAuthUseCase.execute(
      t,
      reply,
      request.module,
      request.body
    );

    if (responseAuth) {
      return sendResponse(reply, {
        message: t('login_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: responseAuth,
      });
    }

    return sendResponse(reply, {
      message: t('login_invalid'),
      httpStatusCode: EHTTPStatusCode.unauthorized,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
