import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleScheduleControllerError } from '@core/controllers/schedule/methods/handleScheduleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListScheduleRequest } from '@core/schema/schedule/listSchedule/request.schema';
import { ScheduleListerUseCase } from '@core/useCases/schedule/ScheduleLister.useCase';

export const listSchedule = async (
  request: FastifyRequest<{
    Querystring: ListScheduleRequest;
  }>,
  reply: FastifyReply
) => {
  const scheduleListerUseCase = container.resolve(ScheduleListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await scheduleListerUseCase.execute(
      request.query,
      tokenJwtData.account_id,
      tokenJwtData.channels
    );

    if (response) {
      return sendResponse(reply, {
        message: t('schedule_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('schedule_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleScheduleControllerError(error, reply, t);
  }
};
