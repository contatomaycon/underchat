import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleScheduleControllerError } from '@core/controllers/schedule/methods/handleScheduleControllerError';
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
  const { t, tokenJwtData } = request;

  try {
    const response = await scheduleDeleterUseCase.execute(
      t,
      request.params.schedule_id,
      tokenJwtData.account_id,
      tokenJwtData.channels
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
    handleScheduleControllerError(error, reply, t);
  }
};
