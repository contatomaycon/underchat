import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleContactCreationControllerError } from '@core/common/functions/handleContactCreationControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateChatContactRequest } from '@core/schema/chat/createContact/request.schema';
import { ChatContactCreatorUseCase } from '@core/useCases/chat/ChatContactCreator.useCase';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

export const createContact = async (
  request: FastifyRequest<{
    Body: CreateChatContactRequest;
  }>,
  reply: FastifyReply
) => {
  const chatContactCreatorUseCase = container.resolve(
    ChatContactCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const allowedChannelIds = tokenJwtData.channels?.map((c) => c.id) ?? [];
    const response = await chatContactCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id,
      allowedChannelIds,
      tokenJwtData.user_id,
      resolveOutboundWebhookRequestSource(request.module)
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: null,
      });
    }

    return sendResponse(reply, {
      message: t('contact_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleContactCreationControllerError(error, reply, t);
  }
};
