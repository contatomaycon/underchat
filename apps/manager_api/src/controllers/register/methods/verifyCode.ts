import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AuthRegisterVerifyCodeRequest } from '@core/schema/register/verifyCode/request.schema';
import { AuthRegisterVerifyCodeUseCase } from '@core/useCases/auth/AuthRegisterVerifyCode.useCase';

export const verifyCode = async (
  request: FastifyRequest<{
    Body: AuthRegisterVerifyCodeRequest;
  }>,
  reply: FastifyReply
) => {
  const authRegisterVerifyCodeUseCase = container.resolve(
    AuthRegisterVerifyCodeUseCase
  );
  const { t } = request;

  try {
    const token = await authRegisterVerifyCodeUseCase.execute(
      t,
      reply,
      request.body
    );

    return sendResponse(reply, {
      message: t('register_code_verified'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: {
        token,
      },
    });
  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('register_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
