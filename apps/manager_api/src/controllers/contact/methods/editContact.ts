import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditContactParamsRequest,
  UpdateContactRequest,
} from '@core/schema/contact/editContact/request.schema';
import { ContactUpdaterUseCase } from '@core/useCases/contact/ContactUpdater.useCase';

export const editContact = async (
  request: FastifyRequest<{
    Params: EditContactParamsRequest;
    Body: UpdateContactRequest;
  }>,
  reply: FastifyReply
) => {
  const contactUpdaterUseCase = container.resolve(ContactUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await contactUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.contact_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('contact_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

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
