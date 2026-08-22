import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserAttendanceHoursStatusViewerUseCase } from '@core/useCases/user/UserAttendanceHoursStatusViewer.useCase';

export const viewAttendanceHoursStatus = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const userAttendanceHoursStatusViewerUseCase = container.resolve(
    UserAttendanceHoursStatusViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await userAttendanceHoursStatusViewerUseCase.execute(
      t,
      tokenJwtData.user_id,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('user_attendance_hours_status_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
