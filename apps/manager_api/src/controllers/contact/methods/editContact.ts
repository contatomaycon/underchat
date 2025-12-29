import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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

    return sendResponse(reply, {
      message: t('contact_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
