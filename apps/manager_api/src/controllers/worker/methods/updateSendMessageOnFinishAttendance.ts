import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateSendMessageOnFinishAttendanceUseCase } from '@core/useCases/worker/UpdateSendMessageOnFinishAttendance.useCase';
import {
  UpdateSendMessageOnFinishAttendanceRequest,
  UpdateSendMessageOnFinishAttendanceParams,
} from '@core/schema/worker/updateSendMessageOnFinishAttendance/request.schema';

export const updateSendMessageOnFinishAttendance = async (
  request: FastifyRequest<{
    Params: UpdateSendMessageOnFinishAttendanceParams;
    Body: UpdateSendMessageOnFinishAttendanceRequest;
  }>,
  reply: FastifyReply
) => {
  const updateSendMessageOnFinishAttendanceUseCase = container.resolve(
    UpdateSendMessageOnFinishAttendanceUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateSendMessageOnFinishAttendanceUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('send_message_on_finish_attendance_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
