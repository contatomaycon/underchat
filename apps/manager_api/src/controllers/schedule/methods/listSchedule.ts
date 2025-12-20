import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      tokenJwtData.account_id
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
