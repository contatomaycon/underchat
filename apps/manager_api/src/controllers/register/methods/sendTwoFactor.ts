import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AuthRegisterSendTwoFactorRequest } from '@core/schema/register/sendTwoFactor/request.schema';
import { AuthRegisterSendTwoFactorUseCase } from '@core/useCases/auth/AuthRegisterSendTwoFactor.useCase';

export const sendTwoFactor = async (
  request: FastifyRequest<{
    Body: AuthRegisterSendTwoFactorRequest;
  }>,
  reply: FastifyReply
) => {
  const authRegisterSendTwoFactorUseCase = container.resolve(
    AuthRegisterSendTwoFactorUseCase
  );
  const { t } = request;

  try {
    await authRegisterSendTwoFactorUseCase.execute(t, request.body);

    return sendResponse(reply, {
      message: t('register_code_sent'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: {
        success: true,
        message: t('register_code_sent'),
      },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
