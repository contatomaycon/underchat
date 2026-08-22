import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditContactParamsRequest,
  UpdateContactRequest,
} from '@core/schema/contact/editContact/request.schema';
import { ContactUpdaterUseCase } from '@core/useCases/contact/ContactUpdater.useCase';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { handleChatMutationControllerError } from '@core/controllers/chat/methods/handleChatMutationControllerError';

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
    const allowedChannelIds = tokenJwtData.channels?.map((c) => c.id) ?? [];
    const response = await contactUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.contact_id,
      request.body,
      allowedChannelIds,
      tokenJwtData.user_id,
      resolveOutboundWebhookRequestSource(request.module)
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
    handleChatMutationControllerError(error, reply, t, {
      sanitizeUnexpected: true,
    });
  }
};
