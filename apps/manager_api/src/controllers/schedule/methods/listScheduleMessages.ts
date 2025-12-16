import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListScheduleMessagesRequest } from '@core/schema/schedule/listScheduleMessages/request.schema';
import { ScheduleMessagesListerUseCase } from '@core/useCases/schedule/ScheduleMessagesLister.useCase';

export const listScheduleMessages = async (
  request: FastifyRequest<{
    Querystring: ListScheduleMessagesRequest;
  }>,
  reply: FastifyReply
) => {
  const scheduleMessagesListerUseCase = container.resolve(
    ScheduleMessagesListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await scheduleMessagesListerUseCase.execute(
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('schedule_messages_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('schedule_messages_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
      data: null,
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
