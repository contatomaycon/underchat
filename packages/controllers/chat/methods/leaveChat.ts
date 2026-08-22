import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  LeaveChatBody,
  LeaveChatParams,
} from '@core/schema/chat/leaveChat/request.schema';
import { LeaveChatUseCase } from '@core/useCases/chat/LeaveChat.useCase';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { handleChatMutationControllerError } from './handleChatMutationControllerError';

export const leaveChat = async (
  request: FastifyRequest<{
    Params: LeaveChatParams;
    Body: LeaveChatBody;
  }>,
  reply: FastifyReply
) => {
  const leaveChatUseCase = container.resolve(LeaveChatUseCase);
  const { t, tokenJwtData } = request;
  const body = (request.body ?? undefined) as LeaveChatBody;

  try {
    const response = await leaveChatUseCase.execute(
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
      message: t('chat_leave_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleChatMutationControllerError(error, reply, t);
  }
};
