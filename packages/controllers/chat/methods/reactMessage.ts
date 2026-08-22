import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatMessageCreatorUseCase } from '@core/useCases/chat/ChatMessageCreator.useCase';
import {
  ReactMessageParams,
  ReactMessageBody,
} from '@core/schema/chat/reactMessage/request.schema';
import {
  CreateMessageChatsParams,
  CreateMessageChatsBody,
} from '@core/schema/chat/createMessageChats/request.schema';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import {
  handleChatMessageControllerError,
  sendAcceptedWorkerCommandAfterProjectionError,
} from './handleChatMessageControllerError';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { runWithWorkerCommandAcceptanceContext } from '@core/common/functions/workerCommandAcceptanceContext';
import { v7 as uuidv7 } from 'uuid';

export const reactMessage = async (
  request: FastifyRequest<{
    Params: ReactMessageParams;
    Body: ReactMessageBody;
  }>,
  reply: FastifyReply
) => {
  const chatMessageCreatorUseCase = container.resolve(
    ChatMessageCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const params: CreateMessageChatsParams = {
      chat_id: request.params.chat_id,
    };

    const operationId = request.body.operation_id ?? uuidv7();
    const body: CreateMessageChatsBody = {
      operation_id: operationId,
      retry_of: request.body.retry_of,
      type: 'react' as any,
      reaction_message_id: request.params.message_id,
      reaction_emoji: request.body.emoji,
    };

    const { value: response, receipts } =
      await runWithWorkerCommandAcceptanceContext(
        () =>
          chatMessageCreatorUseCase.execute(
            t,
            tokenJwtData.account_id,
            params,
            body,
            ETypeUserChat.operator,
            tokenJwtData.user_id,
            tokenJwtData.actions,
            tokenJwtData.sectors,
            tokenJwtData.channels,
            resolveOutboundWebhookRequestSource(request.module)
          ),
        { retryOf: request.body.retry_of }
      );

    if (response) {
      const receipt = receipts.at(-1);
      const acceptedOperationId = receipt?.operation_id ?? operationId;
      reply.header('X-Operation-Id', acceptedOperationId);
      reply.header('X-Command-Acceptance-Count', String(receipts.length));
      if (receipt) {
        reply.header('X-Command-Id', receipt.command_id);
        reply.header('X-Command-Accepted-At', receipt.accepted_at);
        reply.header('X-Operation-Expires-At', receipt.expires_at);
      }
      return reply.code(EHTTPStatusCode.ok).send({
        id: request.id ?? null,
        status: true,
        message: t('chat_reaction_success'),
        data: response,
        operation_id: acceptedOperationId,
        accepted_commands: receipts,
        ...(receipt
          ? {
              command_id: receipt.command_id,
              accepted_at: receipt.accepted_at,
              expires_at: receipt.expires_at,
            }
          : {}),
      });
    }

    return sendResponse(reply, {
      message: t('chat_reaction_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    if (
      sendAcceptedWorkerCommandAfterProjectionError(
        error,
        reply,
        t('chat_reaction_success')
      )
    ) {
      return;
    }
    handleChatMessageControllerError(error, reply, t);
  }
};
