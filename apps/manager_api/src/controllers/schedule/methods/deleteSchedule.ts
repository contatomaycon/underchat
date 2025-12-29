import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteScheduleRequest } from '@core/schema/schedule/deleteSchedule/request.schema';
import { ScheduleDeleterUseCase } from '@core/useCases/schedule/ScheduleDeleter.useCase';

export const deleteSchedule = async (
  request: FastifyRequest<{
    Params: DeleteScheduleRequest;
  }>,
  reply: FastifyReply
) => {
  const scheduleDeleterUseCase = container.resolve(ScheduleDeleterUseCase);
  const { t } = request;

  try {
    const response = await scheduleDeleterUseCase.execute(
      t,
      request.params.schedule_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('schedule_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('schedule_deleter_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
