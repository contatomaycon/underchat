import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  JoinChatParams,
  JoinChatBody,
} from '@core/schema/chat/joinChat/request.schema';
import { JoinChatUseCase } from '@core/useCases/chat/JoinChat.useCase';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { handleChatMutationControllerError } from './handleChatMutationControllerError';

export const joinChat = async (
  request: FastifyRequest<{
    Params: JoinChatParams;
    Body: JoinChatBody;
  }>,
  reply: FastifyReply
) => {
  const joinChatUseCase = container.resolve(JoinChatUseCase);
  const { t, tokenJwtData } = request;
  const body = (request.body ?? undefined) as JoinChatBody;

  try {
    const response = await joinChatUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      body,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels,
      resolveOutboundWebhookRequestSource(request.module)
    );

    return sendResponse(reply, {
      message: t('chat_join_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleChatMutationControllerError(error, reply, t);
  }
};
