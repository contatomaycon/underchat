import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
    console.error(error);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
