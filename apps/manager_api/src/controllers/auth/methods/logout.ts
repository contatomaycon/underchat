import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AuthLogoutUseCase } from '@core/useCases/auth/AuthLogout.useCase';

export const logout = async (request: FastifyRequest, reply: FastifyReply) => {
  const authLogoutUseCase = container.resolve(AuthLogoutUseCase);
  const { t, tokenJwtData } = request;

  try {
    await authLogoutUseCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      tokenJwtData.session_platform ?? null
    );

    return sendResponse(reply, {
      message: t('logout_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: null,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
