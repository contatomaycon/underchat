import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SessionLoginRequest } from '@core/schema/user/sessionLogin/request.schema';
import { UserSessionLoginUseCase } from '@core/useCases/user/UserSessionLogin.useCase';

export const sessionLogin = async (
  request: FastifyRequest<{
    Params: SessionLoginRequest;
  }>,
  reply: FastifyReply
) => {
  const userSessionLoginUseCase = container.resolve(UserSessionLoginUseCase);
  const { t, module } = request;

  try {
    const response = await userSessionLoginUseCase.execute(
      t,
      reply,
      module,
      request.params.user_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('session_login_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('session_login_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
