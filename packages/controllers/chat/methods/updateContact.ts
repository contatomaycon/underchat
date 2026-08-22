import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateChatContactParamsRequest,
  UpdateChatContactRequest,
} from '@core/schema/chat/updateContact/request.schema';
import { ChatContactUpdaterUseCase } from '@core/useCases/chat/ChatContactUpdater.useCase';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { handleChatMutationControllerError } from './handleChatMutationControllerError';

export const updateContact = async (
  request: FastifyRequest<{
    Params: UpdateChatContactParamsRequest;
    Body: UpdateChatContactRequest;
  }>,
  reply: FastifyReply
) => {
  const chatContactUpdaterUseCase = container.resolve(
    ChatContactUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const allowedChannelIds = tokenJwtData.channels?.map((c) => c.id) ?? [];
    const response = await chatContactUpdaterUseCase.execute(
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
        data: null,
      });
    }

    return sendResponse(reply, {
      message: t('contact_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleChatMutationControllerError(error, reply, t);
  }
};
