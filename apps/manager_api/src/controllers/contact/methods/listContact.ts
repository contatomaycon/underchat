import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      t,
      request.query,
      tokenJwtData.is_administrator,
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
