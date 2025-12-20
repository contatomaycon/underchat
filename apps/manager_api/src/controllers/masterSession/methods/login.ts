import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { LoginRequest } from '@core/schema/masterSession/login/request.schema';
import { AuthMasterSessionLoginUseCase } from '@core/useCases/auth/AuthMasterSessionLogin.useCase';

export const login = async (
  request: FastifyRequest<{
    Body: LoginRequest;
  }>,
  reply: FastifyReply
) => {
  const authMasterSessionLoginUseCase = container.resolve(
    AuthMasterSessionLoginUseCase
  );
  const { t } = request;

  try {
    const responseAuth = await authMasterSessionLoginUseCase.execute(
      t,
      reply,
      request.module,
      request.body.account_id
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
    console.error(error);

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
