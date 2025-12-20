import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      tokenJwtData.account_id
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
