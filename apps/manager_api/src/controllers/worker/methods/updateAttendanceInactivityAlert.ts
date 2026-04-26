import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateAttendanceInactivityAlertUseCase } from '@core/useCases/worker/UpdateAttendanceInactivityAlert.useCase';
import {
  UpdateAttendanceInactivityAlertParams,
  UpdateAttendanceInactivityAlertRequest,
} from '@core/schema/worker/updateAttendanceInactivityAlert/request.schema';

export const updateAttendanceInactivityAlert = async (
  request: FastifyRequest<{
    Params: UpdateAttendanceInactivityAlertParams;
    Body: UpdateAttendanceInactivityAlertRequest;
  }>,
  reply: FastifyReply
) => {
  const updateAttendanceInactivityAlertUseCase = container.resolve(
    UpdateAttendanceInactivityAlertUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateAttendanceInactivityAlertUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('attendance_inactivity_alert_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
