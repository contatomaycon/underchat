import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleScheduleControllerError } from '@core/controllers/schedule/methods/handleScheduleControllerError';
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
      t,
      request.query,
      tokenJwtData.account_id,
      tokenJwtData.channels
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
    handleScheduleControllerError(error, reply, t);
  }
};
