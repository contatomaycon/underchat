import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  ForwardMessageBody,
  ForwardMessageParams,
} from '@core/schema/chat/forwardMessage/request.schema';
import { ChatMessageForwarderUseCase } from '@core/useCases/chat/ChatMessageForwarder.useCase';
import { handleChatMessageControllerError } from './handleChatMessageControllerError';
import { resolveOutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { runWithWorkerCommandAcceptanceContext } from '@core/common/functions/workerCommandAcceptanceContext';
import { v7 as uuidv7 } from 'uuid';

export const forwardMessage = async (
  request: FastifyRequest<{
    Params: ForwardMessageParams;
    Body: ForwardMessageBody;
  }>,
  reply: FastifyReply
) => {
  const chatMessageForwarderUseCase = container.resolve(
    ChatMessageForwarderUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const idempotencyKey = request.body.idempotency_key ?? uuidv7();
    const body: ForwardMessageBody = {
      ...request.body,
      idempotency_key: idempotencyKey,
    };
    const retryOf = body.retry_of?.trim() || null;
    const { value: response, receipts } =
      await runWithWorkerCommandAcceptanceContext(
        () =>
          chatMessageForwarderUseCase.execute(
            t,
            tokenJwtData.account_id,
            request.params,
            body,
            tokenJwtData.user_id,
            tokenJwtData.actions,
            tokenJwtData.sectors,
            tokenJwtData.channels,
            resolveOutboundWebhookRequestSource(request.module)
          ),
        { retryOf }
      );

    const hasPartialFailure = response.failed > 0;
    const message = hasPartialFailure
      ? t('chat_forward_partial_success', {
          sent: response.sent,
          failed: response.failed,
        })
      : t('chat_forward_success');

    const receipt = receipts.at(-1);
    if (receipt) {
      reply.header('X-Operation-Id', receipt.operation_id);
      reply.header('X-Command-Id', receipt.command_id);
      reply.header('X-Command-Accepted-At', receipt.accepted_at);
      reply.header('X-Operation-Expires-At', receipt.expires_at);
    }
    reply.header('X-Command-Acceptance-Count', String(receipts.length));
    return reply.code(EHTTPStatusCode.ok).send({
      id: request.id ?? null,
      status: true,
      message,
      data: response,
      idempotency_key: idempotencyKey,
      commands: receipts,
    });
  } catch (error) {
    handleChatMessageControllerError(error, reply, t);
  }
};
