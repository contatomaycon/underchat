import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AuthLoginRequest } from '@core/schema/auth/login/request.schema';
import { AuthLoginUseCase } from '@core/useCases/auth/AuthLogin.useCase';
import { UserAttendanceHoursBlockedError } from '@core/common/exceptions/UserAttendanceHoursBlockedError';
import { USER_ATTENDANCE_HOURS_BLOCK_REASON } from '@core/common/functions/userAttendanceHours';
import { resolveSessionPlatformFromHeaders } from '@core/common/functions/sessionPlatform';

export const login = async (
  request: FastifyRequest<{
    Body: AuthLoginRequest;
  }>,
  reply: FastifyReply
) => {
  const loginAuthUseCase = container.resolve(AuthLoginUseCase);
  const { t } = request;
  const sessionPlatform = resolveSessionPlatformFromHeaders(request.headers);

  try {
    const responseAuth = await loginAuthUseCase.execute(
      t,
      reply,
      request.module,
      request.body,
      sessionPlatform
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

    if (
      error instanceof Error &&
      (error.message === t('login_invalid') ||
        error.message === t('user_without_access_group'))
    ) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    handleControllerError(error, reply, t);
  }
};
