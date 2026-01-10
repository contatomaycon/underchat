import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AuthForgotPasswordVerifyCodeRequest } from '@core/schema/auth/forgotPassword/verifyCode/request.schema';
import { AuthForgotPasswordVerifyCodeUseCase } from '@core/useCases/auth/AuthForgotPasswordVerifyCode.useCase';

export const forgotPasswordVerifyCode = async (
  request: FastifyRequest<{
    Body: AuthForgotPasswordVerifyCodeRequest;
  }>,
  reply: FastifyReply
) => {
  const authForgotPasswordVerifyCodeUseCase = container.resolve(
    AuthForgotPasswordVerifyCodeUseCase
  );
  const { t } = request;

  try {
    const response = await authForgotPasswordVerifyCodeUseCase.execute(
      t,
      reply,
      request.module,
      request.body
    );

    return sendResponse(reply, {
      message: t('forgot_password_code_verified'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
