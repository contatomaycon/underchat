import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditMessageParams,
  EditMessageBody,
} from '@core/schema/chat/editMessage/request.schema';
import { ChatMessageEditorUseCase } from '@core/useCases/chat/ChatMessageEditor.useCase';
import {
  handleChatMessageControllerError,
  sendAcceptedWorkerCommandAfterProjectionError,
} from './handleChatMessageControllerError';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { runWithWorkerCommandAcceptanceContext } from '@core/common/functions/workerCommandAcceptanceContext';
import { v7 as uuidv7 } from 'uuid';

export const editMessage = async (
  request: FastifyRequest<{
    Params: EditMessageParams;
    Body: EditMessageBody;
  }>,
  reply: FastifyReply
) => {
  const chatMessageEditorUseCase = container.resolve(ChatMessageEditorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const operationId = request.body.operation_id ?? uuidv7();
    const body: EditMessageBody = {
      ...request.body,
      operation_id: operationId,
    };
    const { value: response, receipts } =
      await runWithWorkerCommandAcceptanceContext(
        () =>
          chatMessageEditorUseCase.execute(
            t,
            tokenJwtData.account_id,
            request.params,
            body,
            tokenJwtData.user_id,
            tokenJwtData.channels,
            resolveOutboundWebhookRequestSource(request.module)
          ),
        { retryOf: body.retry_of }
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
        message: t('chat_edit_success'),
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
      message: t('chat_edit_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    if (
      sendAcceptedWorkerCommandAfterProjectionError(
        error,
        reply,
        t('chat_edit_success')
      )
    ) {
      return;
    }
    handleChatMessageControllerError(error, reply, t);
  }
};
