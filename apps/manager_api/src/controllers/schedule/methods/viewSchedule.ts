import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
  const { t } = request;

  try {
    const response = await scheduleViewerUseCase.execute(
      t,
      request.params.schedule_id
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
    handleControllerError(error, reply, t);
  }
};
