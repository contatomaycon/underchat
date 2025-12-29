import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListContactRequest } from '@core/schema/contact/listContact/request.schema';
import { ContactListerUseCase } from '@core/useCases/contact/ContactLister.useCase';

export const listContact = async (
  request: FastifyRequest<{
    Querystring: ListContactRequest;
  }>,
  reply: FastifyReply
) => {
  const contactListerUseCase = container.resolve(ContactListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await contactListerUseCase.execute(
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('contact_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
