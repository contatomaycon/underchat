import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  TransferChatParams,
  TransferChatBody,
} from '@core/schema/chat/transferChat/request.schema';
import { TransferChatUseCase } from '@core/useCases/chat/TransferChat.useCase';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { handleChatMutationControllerError } from './handleChatMutationControllerError';

export const transferChat = async (
  request: FastifyRequest<{
    Params: TransferChatParams;
    Body: TransferChatBody;
  }>,
  reply: FastifyReply
) => {
  const transferChatUseCase = container.resolve(TransferChatUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await transferChatUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      request.body,
      tokenJwtData.user_id,
      tokenJwtData.permission_role_id ?? null,
      tokenJwtData.actions,
      tokenJwtData.channels,
      resolveOutboundWebhookRequestSource(request.module)
    );

    return sendResponse(reply, {
      message: t('chat_transfer_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleChatMutationControllerError(error, reply, t);
  }
};
