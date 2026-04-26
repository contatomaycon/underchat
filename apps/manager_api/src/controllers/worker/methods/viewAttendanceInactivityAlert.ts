import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewAttendanceInactivityAlertUseCase } from '@core/useCases/worker/ViewAttendanceInactivityAlert.useCase';
import { ViewAttendanceInactivityAlertParams } from '@core/schema/worker/viewAttendanceInactivityAlert/request.schema';

export const viewAttendanceInactivityAlert = async (
  request: FastifyRequest<{
    Params: ViewAttendanceInactivityAlertParams;
  }>,
  reply: FastifyReply
) => {
  const viewAttendanceInactivityAlertUseCase = container.resolve(
    ViewAttendanceInactivityAlertUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewAttendanceInactivityAlertUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('attendance_inactivity_alert_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
