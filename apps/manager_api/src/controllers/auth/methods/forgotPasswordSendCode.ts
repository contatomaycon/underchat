import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AuthForgotPasswordSendCodeRequest } from '@core/schema/auth/forgotPassword/sendCode/request.schema';
import { AuthForgotPasswordSendCodeUseCase } from '@core/useCases/auth/AuthForgotPasswordSendCode.useCase';

export const forgotPasswordSendCode = async (
  request: FastifyRequest<{
    Body: AuthForgotPasswordSendCodeRequest;
  }>,
  reply: FastifyReply
) => {
  const authForgotPasswordSendCodeUseCase = container.resolve(
    AuthForgotPasswordSendCodeUseCase
  );
  const { t } = request;

  try {
    const response = await authForgotPasswordSendCodeUseCase.execute(
      t,
      request.body
    );

    return sendResponse(reply, {
      message: t('forgot_password_code_sent'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
