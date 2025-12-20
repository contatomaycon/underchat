import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListScheduleContactsRequest } from '@core/schema/schedule/listScheduleContacts/request.schema';
import { ScheduleContactsListerUseCase } from '@core/useCases/schedule/ScheduleContactsLister.useCase';

export const listScheduleContacts = async (
  request: FastifyRequest<{
    Querystring: ListScheduleContactsRequest;
  }>,
  reply: FastifyReply
) => {
  const scheduleContactsListerUseCase = container.resolve(
    ScheduleContactsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await scheduleContactsListerUseCase.execute(
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('schedule_contacts_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('schedule_contacts_list_not_found'),
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
