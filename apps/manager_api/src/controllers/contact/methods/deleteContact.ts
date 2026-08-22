import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteContactRequest } from '@core/schema/contact/deleteContact/request.schema';
import { ContactDeleterUseCase } from '@core/useCases/contact/ContactDeleter.useCase';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

export const deleteContact = async (
  request: FastifyRequest<{
    Params: DeleteContactRequest;
  }>,
  reply: FastifyReply
) => {
  const contactDeleterUseCase = container.resolve(ContactDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await contactDeleterUseCase.execute(
      t,
      request.params.contact_id,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      resolveOutboundWebhookRequestSource(request.module)
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
    handleControllerError(error, reply, t);
  }
};
