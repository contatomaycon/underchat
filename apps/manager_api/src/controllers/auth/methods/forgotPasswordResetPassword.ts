import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AuthForgotPasswordResetPasswordRequest } from '@core/schema/auth/forgotPassword/resetPassword/request.schema';
import { AuthForgotPasswordResetPasswordUseCase } from '@core/useCases/auth/AuthForgotPasswordResetPassword.useCase';
import { generalEnvironment } from '@core/config/environments';
import { UserAttendanceHoursBlockedError } from '@core/common/exceptions/UserAttendanceHoursBlockedError';
import { USER_ATTENDANCE_HOURS_BLOCK_REASON } from '@core/common/functions/userAttendanceHours';
import { resolveSessionPlatformFromHeaders } from '@core/common/functions/sessionPlatform';

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
  const sessionPlatform = resolveSessionPlatformFromHeaders(request.headers);

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
      request.body,
      sessionPlatform
    );

    return sendResponse(reply, {
      message: t('password_reset_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    if (error instanceof UserAttendanceHoursBlockedError) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.forbidden,
        data: {
          reason: USER_ATTENDANCE_HOURS_BLOCK_REASON,
          attendance_guard: error.attendanceGuard,
        },
      });
    }

    if (error instanceof Error && error.message.includes('jwt')) {
      return sendResponse(reply, {
        message: t('forgot_password_token_invalid'),
        httpStatusCode: EHTTPStatusCode.bad_request,
        data: null,
      });
    }

    if (
      error instanceof Error &&
      error.message === t('user_without_access_permissions')
    ) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    handleControllerError(error, reply, t);
  }
};
