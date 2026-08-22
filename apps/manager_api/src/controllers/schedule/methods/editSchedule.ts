import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleScheduleControllerError } from '@core/controllers/schedule/methods/handleScheduleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditScheduleParamsRequest,
  UpdateScheduleRequest,
} from '@core/schema/schedule/editSchedule/request.schema';
import { ScheduleUpdaterUseCase } from '@core/useCases/schedule/ScheduleUpdater.useCase';

export const editSchedule = async (
  request: FastifyRequest<{
    Params: EditScheduleParamsRequest;
    Body: UpdateScheduleRequest;
  }>,
  reply: FastifyReply
) => {
  const scheduleUpdaterUseCase = container.resolve(ScheduleUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await scheduleUpdaterUseCase.execute(
      t,
      request.params.schedule_id,
      request.body,
      tokenJwtData.account_id,
      tokenJwtData.channels
    );

    if (response) {
      return sendResponse(reply, {
        message: t('schedule_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('schedule_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleScheduleControllerError(error, reply, t);
  }
};
