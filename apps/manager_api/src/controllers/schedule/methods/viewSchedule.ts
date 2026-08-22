import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleScheduleControllerError } from '@core/controllers/schedule/methods/handleScheduleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewScheduleRequest } from '@core/schema/schedule/viewSchedule/request.schema';
import { ScheduleViewerUseCase } from '@core/useCases/schedule/ScheduleViewer.useCase';

export const viewSchedule = async (
  request: FastifyRequest<{
    Params: ViewScheduleRequest;
  }>,
  reply: FastifyReply
) => {
  const scheduleViewerUseCase = container.resolve(ScheduleViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await scheduleViewerUseCase.execute(
      t,
      request.params.schedule_id,
      tokenJwtData.account_id,
      tokenJwtData.channels
    );

    if (response) {
      return sendResponse(reply, {
        message: t('schedule_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('schedule_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleScheduleControllerError(error, reply, t);
  }
};
