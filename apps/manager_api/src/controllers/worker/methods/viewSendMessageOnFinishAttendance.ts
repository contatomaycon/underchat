import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewSendMessageOnFinishAttendanceUseCase } from '@core/useCases/worker/ViewSendMessageOnFinishAttendance.useCase';
import { ViewSendMessageOnFinishAttendanceParams } from '@core/schema/worker/viewSendMessageOnFinishAttendance/request.schema';

export const viewSendMessageOnFinishAttendance = async (
  request: FastifyRequest<{
    Params: ViewSendMessageOnFinishAttendanceParams;
  }>,
  reply: FastifyReply
) => {
  const viewSendMessageOnFinishAttendanceUseCase = container.resolve(
    ViewSendMessageOnFinishAttendanceUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewSendMessageOnFinishAttendanceUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('send_message_on_finish_attendance_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
