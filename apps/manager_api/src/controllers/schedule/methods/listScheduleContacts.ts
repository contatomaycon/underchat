import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
