import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AuthRefreshTokenUseCase } from '@core/useCases/auth/AuthRefreshToken.useCase';

export const refreshToken = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const { t } = request;
  const authRefreshTokenUseCase = container.resolve(AuthRefreshTokenUseCase);

  try {
    const responseAuth = await authRefreshTokenUseCase.execute(
      t,
      request,
      reply
    );

    if (!responseAuth) {
      return sendResponse(reply, {
        message: t('invalid_token'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    return sendResponse(reply, {
      message: t('token_generated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: responseAuth,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
