import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateForwardToOutputChatbotParams,
  UpdateForwardToOutputChatbotRequest,
} from '@core/schema/chat/updateForwardToOutputChatbot/request.schema';
import { ChatForwardToOutputChatbotUpdaterUseCase } from '@core/useCases/chat/ChatForwardToOutputChatbotUpdater.useCase';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { handleChatMutationControllerError } from './handleChatMutationControllerError';

export const updateForwardToOutputChatbot = async (
  request: FastifyRequest<{
    Params: UpdateForwardToOutputChatbotParams;
    Body: UpdateForwardToOutputChatbotRequest;
  }>,
  reply: FastifyReply
) => {
  const chatForwardToOutputChatbotUpdaterUseCase = container.resolve(
    ChatForwardToOutputChatbotUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatForwardToOutputChatbotUpdaterUseCase.execute(
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
        message: t('chat_forward_to_output_chatbot_update_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: { success: true },
      });
    }

    return sendResponse(reply, {
      message: t('chat_forward_to_output_chatbot_update_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleChatMutationControllerError(error, reply, t);
  }
};
