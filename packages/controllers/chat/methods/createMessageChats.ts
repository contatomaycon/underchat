import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  CreateMessageChatsBody,
  CreateMessageChatsParams,
} from '@core/schema/chat/createMessageChats/request.schema';
import { ChatMessageCreatorUseCase } from '@core/useCases/chat/ChatMessageCreator.useCase';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import {
  handleChatMessageControllerError,
  sendAcceptedWorkerCommandAfterProjectionError,
} from './handleChatMessageControllerError';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { runWithWorkerCommandAcceptanceContext } from '@core/common/functions/workerCommandAcceptanceContext';
import { buildDeterministicMessageHash } from '@core/common/functions/messageIdentity';
import { v7 as uuidv7 } from 'uuid';

function extractIdentityField(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && 'value' in value) {
    return extractIdentityField((value as { value?: unknown }).value);
  }
  return null;
}

function normalizeLegacyHash(value: unknown): string | null {
  const hash = extractIdentityField(value)?.trim();
  if (!hash || hash === 'null' || hash === 'undefined') {
    return null;
  }
  return hash;
}

export const createMessageChats = async (
  request: FastifyRequest<{
    Params: CreateMessageChatsParams;
    Body: CreateMessageChatsBody;
  }>,
  reply: FastifyReply
) => {
  const chatMessageCreatorUseCase = container.resolve(
    ChatMessageCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const requestedOperationId = extractIdentityField(
      request.body.operation_id
    );
    const legacyHash = normalizeLegacyHash(request.body.hash);
    const generatedOperationId =
      requestedOperationId === null && legacyHash === null ? uuidv7() : null;
    const body: CreateMessageChatsBody = generatedOperationId
      ? { ...request.body, operation_id: generatedOperationId }
      : request.body;
    const operationId =
      requestedOperationId ??
      generatedOperationId ??
      buildDeterministicMessageHash(
        tokenJwtData.account_id,
        request.params.chat_id,
        `client:${legacyHash}`
      );
    const rawRetryOf = body.retry_of;
    const retryOf =
      typeof rawRetryOf === 'string'
        ? rawRetryOf
        : rawRetryOf && typeof rawRetryOf === 'object'
          ? rawRetryOf.value
          : null;
    const { value: response, receipts } =
      await runWithWorkerCommandAcceptanceContext(
        () =>
          chatMessageCreatorUseCase.execute(
            t,
            tokenJwtData.account_id,
            request.params,
            body,
            ETypeUserChat.operator,
            tokenJwtData.user_id,
            tokenJwtData.actions,
            tokenJwtData.sectors,
            tokenJwtData.channels,
            resolveOutboundWebhookRequestSource(request.module)
          ),
        { retryOf }
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
        message: t('chat_create_success'),
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
      message: t('chat_create_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    if (
      sendAcceptedWorkerCommandAfterProjectionError(
        error,
        reply,
        t('chat_create_success')
      )
    ) {
      return;
    }
    handleChatMessageControllerError(error, reply, t);
  }
};
