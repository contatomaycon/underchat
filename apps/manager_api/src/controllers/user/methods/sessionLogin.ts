import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SessionLoginRequest } from '@core/schema/user/sessionLogin/request.schema';
import { UserSessionLoginUseCase } from '@core/useCases/user/UserSessionLogin.useCase';
import { UserAttendanceHoursBlockedError } from '@core/common/exceptions/UserAttendanceHoursBlockedError';
import { USER_ATTENDANCE_HOURS_BLOCK_REASON } from '@core/common/functions/userAttendanceHours';
import { resolveSessionPlatformFromHeaders } from '@core/common/functions/sessionPlatform';

export const sessionLogin = async (
  request: FastifyRequest<{
    Params: SessionLoginRequest;
  }>,
  reply: FastifyReply
) => {
  const userSessionLoginUseCase = container.resolve(UserSessionLoginUseCase);
  const { t, module } = request;
  const sessionPlatform = resolveSessionPlatformFromHeaders(request.headers);

  try {
    const response = await userSessionLoginUseCase.execute(
      t,
      reply,
      module,
      request.params.user_id,
      sessionPlatform
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

    if (error instanceof Error) {
      if (error.message === t('user_without_access_group')) {
        return sendResponse(reply, {
          message: error.message,
          httpStatusCode: EHTTPStatusCode.unauthorized,
        });
      }

      if (error.message === t('user_without_access_permissions')) {
        return sendResponse(reply, {
          message: error.message,
          httpStatusCode: EHTTPStatusCode.forbidden,
        });
      }
    }

    handleControllerError(error, reply, t);
  }
};
