import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AuthForgotPasswordResetPasswordRequest } from '@core/schema/auth/forgotPassword/resetPassword/request.schema';
import { AuthForgotPasswordResetPasswordUseCase } from '@core/useCases/auth/AuthForgotPasswordResetPassword.useCase';
import { generalEnvironment } from '@core/config/environments';

export const forgotPasswordResetPassword = async (
  request: FastifyRequest<{
    Body: AuthForgotPasswordResetPasswordRequest;
  }>,
  reply: FastifyReply
) => {
  const authForgotPasswordResetPasswordUseCase = container.resolve(
    AuthForgotPasswordResetPasswordUseCase
  );
  const { t } = request;

  try {
    const decoded: {
      user_id: string;
      module: any;
      account_id: string;
      forgot_password?: boolean;
    } = await request.jwtVerify({
      verify: {
        key: generalEnvironment.jwtSecret,
      },
      decode: {
        complete: true,
      },
    });

    if (
      !decoded?.forgot_password ||
      !decoded?.user_id ||
      !decoded?.account_id
    ) {
      return sendResponse(reply, {
        message: t('forgot_password_token_invalid'),
        httpStatusCode: EHTTPStatusCode.bad_request,
        data: null,
      });
    }

    const response = await authForgotPasswordResetPasswordUseCase.execute(
      t,
      reply,
      request.module,
      decoded.user_id,
      decoded.account_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('password_reset_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('jwt')) {
      return sendResponse(reply, {
        message: t('forgot_password_token_invalid'),
        httpStatusCode: EHTTPStatusCode.bad_request,
        data: null,
      });
    }
    handleControllerError(error, reply, t);
  }
};
