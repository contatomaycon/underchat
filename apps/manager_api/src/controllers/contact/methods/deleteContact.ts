import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteContactRequest } from '@core/schema/contact/deleteContact/request.schema';
import { ContactDeleterUseCase } from '@core/useCases/contact/ContactDeleter.useCase';

export const deleteContact = async (
  request: FastifyRequest<{
    Params: DeleteContactRequest;
  }>,
  reply: FastifyReply
) => {
  const contactDeleterUseCase = container.resolve(ContactDeleterUseCase);
  const { t } = request;

  try {
    const response = await contactDeleterUseCase.execute(
      t,
      request.params.contact_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }


    return sendResponse(reply, {
      message: t('contact_deleter_error'),
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
