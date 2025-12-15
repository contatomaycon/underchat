import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateScheduleRequest } from '@core/schema/schedule/createSchedule/request.schema';
import { ScheduleCreatorUseCase } from '@core/useCases/schedule/ScheduleCreator.useCase';

export const createSchedule = async (
  request: FastifyRequest<{
    Body: CreateScheduleRequest;
  }>,
  reply: FastifyReply
) => {
  const scheduleCreatorUseCase = container.resolve(ScheduleCreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await scheduleCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('schedule_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('schedule_creator_error'),
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
