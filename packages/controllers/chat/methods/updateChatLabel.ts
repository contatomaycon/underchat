import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateChatLabelParams,
  UpdateChatLabelRequest,
} from '@core/schema/chat/updateChatLabel/request.schema';
import { ChatLabelUpdaterUseCase } from '@core/useCases/chat/ChatLabelUpdater.useCase';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { handleChatMutationControllerError } from './handleChatMutationControllerError';

export const updateChatLabel = async (
  request: FastifyRequest<{
    Params: UpdateChatLabelParams;
    Body: UpdateChatLabelRequest;
  }>,
  reply: FastifyReply
) => {
  const chatLabelUpdaterUseCase = container.resolve(ChatLabelUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatLabelUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      request.body,
      tokenJwtData.channels,
      tokenJwtData.user_id,
      resolveOutboundWebhookRequestSource(request.module)
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_label_update_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: { success: true },
      });
    }

    return sendResponse(reply, {
      message: t('chat_label_update_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleChatMutationControllerError(error, reply, t);
  }
};
