import type { FastifyReply } from 'fastify';
import type { TFunction } from 'i18next';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { WorkerCommandPublishError } from '@core/services/natsJetStreamPublisher.service';
import { WorkerCommandContractError } from '@core/common/functions/workerCommandEnvelope';
import { workerCommandAcceptancesFromError } from '@core/common/functions/workerCommandAcceptanceContext';
import { WorkerCommandOperationalBarrierError } from '@core/services/workerCommandOperationalBarrier.service';

export function sendAcceptedWorkerCommandAfterProjectionError(
  error: unknown,
  reply: FastifyReply,
  message: string
): boolean {
  if (
    error instanceof WorkerCommandPublishError ||
    error instanceof WorkerCommandOperationalBarrierError ||
    (error instanceof WorkerCommandContractError &&
      error.code === 'retry_window_elapsed')
  ) {
    return false;
  }
  const receipts = workerCommandAcceptancesFromError(error);
  const receipt = receipts.at(-1);
  if (!receipt) return false;

  reply.header('X-Operation-Id', receipt.operation_id);
  reply.header('X-Command-Id', receipt.command_id);
  reply.header('X-Command-Accepted-At', receipt.accepted_at);
  reply.header('X-Operation-Expires-At', receipt.expires_at);
  reply.header('X-Command-Acceptance-Count', String(receipts.length));
  reply.code(EHTTPStatusCode.ok).send({
    id: reply.request?.id ?? null,
    status: true,
    message,
    data: true,
    operation_id: receipt.operation_id,
    command_id: receipt.command_id,
    accepted_at: receipt.accepted_at,
    expires_at: receipt.expires_at,
    accepted_commands: receipts,
  });
  return true;
}

const NOT_FOUND_KEYS = [
  'chat_not_found',
  'message_not_found',
  'message_chat_mismatch',
  'worker_not_found',
] as const;

const FORBIDDEN_KEYS = ['chat_access_denied'] as const;

const BAD_REQUEST_KEYS = [
  'audio_required',
  'chat_forward_deleted_message_not_allowed',
  'chat_forward_same_chat_not_allowed',
  'chat_forward_target_chat_ids_required',
  'chat_forward_type_not_supported',
  'chat_forward_worker_required_for_contacts',
  'documents_required',
  'location_coordinates_required',
  'message_content_required',
  'message_edit_timeout',
  'message_jid_not_found',
  'message_key_not_found',
  'message_template_not_found',
  'message_template_type_mismatch',
  'only_text_messages_can_be_edited',
  'worker_command_operation_id_invalid',
  'worker_command_operation_identity_conflict',
  'worker_command_operation_id_required',
  'worker_command_retry_of_invalid',
  'videos_required',
  'whatsapp_official_delete_message_not_supported',
  'whatsapp_official_disappearing_messages_not_supported',
  'whatsapp_official_edit_message_not_supported',
  'whatsapp_official_customer_service_window_closed',
  'whatsapp_official_template_send_uncertain',
  'whatsapp_official_waiting_contact_reply',
  'whatsapp_official_video_note_not_supported',
  'whatsapp_official_view_once_not_supported',
] as const;

const RAW_NOT_FOUND_MESSAGES = new Set([
  'chat_not_found',
  'message_not_found',
  'message_chat_mismatch',
  'Chat não encontrado.',
  'Mensagem não encontrada.',
]);

const RAW_BAD_REQUEST_MESSAGES = new Set([
  'A mensagem não é do tipo áudio.',
  'URL do áudio não encontrada na mensagem.',
  'Canal do chat não encontrado.',
  'Nenhum agente de IA configurado neste canal para transcrição.',
  'O agente de IA não possui Voice IA configurado para transcrição.',
  'Configuração de Voice IA inativa ou sem chave API configurada.',
]);

function translatedMessageSet(
  t: TFunction<'translation', undefined>,
  keys: readonly string[]
): Set<string> {
  return new Set(keys.flatMap((key) => [key, t(key)]));
}

/** Maps expected chat-message domain failures without hiding infrastructure errors. */
export function handleChatMessageControllerError(
  error: unknown,
  reply: FastifyReply,
  t: TFunction<'translation', undefined>
): void {
  if (!(error instanceof Error)) {
    handleControllerError(error, reply, t);
    return;
  }

  const message = error.message;
  const acceptedCommands = workerCommandAcceptancesFromError(error);
  if (acceptedCommands.length > 0) {
    reply.header('X-Command-Acceptance-Count', String(acceptedCommands.length));
  }
  if (error instanceof WorkerCommandPublishError) {
    if (error.operationId) {
      reply.header('X-Operation-Id', error.operationId);
    }
    if (error.expiresAt) {
      reply.header('X-Operation-Expires-At', error.expiresAt);
    }
    if (error.retryUntil) {
      reply.header('X-Operation-Retry-Until', error.retryUntil);
    }
    reply.header('Retry-After', '1');
    sendResponse(reply, {
      message: 'worker_command_acceptance_unknown',
      httpStatusCode: EHTTPStatusCode.service_unavailable,
      data: {
        retryable: true,
        acceptance: 'unknown',
        operation_id: error.operationId ?? null,
        command_id: error.commandId,
        issued_at: error.issuedAt ?? null,
        expires_at: error.expiresAt ?? null,
        retry_until: error.retryUntil ?? null,
        accepted_commands: acceptedCommands,
      },
    });
    return;
  }

  if (
    error instanceof WorkerCommandOperationalBarrierError &&
    error.code === 'paused'
  ) {
    const latestAcceptance = acceptedCommands.at(-1);
    const operationId = error.operationId ?? latestAcceptance?.operation_id;
    if (operationId) reply.header('X-Operation-Id', operationId);
    reply.header('Retry-After', '5');
    sendResponse(reply, {
      message: 'worker_command_operational_barrier_paused',
      httpStatusCode: EHTTPStatusCode.service_unavailable,
      data: {
        retryable: true,
        acceptance: 'rejected',
        reason: error.code,
        operation_id: operationId ?? null,
        barrier_generation: error.status?.generation ?? null,
        barrier_changed_at: error.status?.changed_at ?? null,
        accepted_commands: acceptedCommands,
      },
    });
    return;
  }

  if (
    error instanceof WorkerCommandContractError &&
    error.code === 'retry_window_elapsed'
  ) {
    if (error.operationId) reply.header('X-Operation-Id', error.operationId);
    if (error.expiresAt) {
      reply.header('X-Operation-Expires-At', error.expiresAt);
    }
    sendResponse(reply, {
      message: 'worker_command_retry_window_elapsed',
      httpStatusCode: EHTTPStatusCode.gone,
      data: {
        retryable: false,
        reason: error.code,
        operation_id: error.operationId ?? null,
        command_id: error.commandId ?? null,
        issued_at: error.issuedAt ?? null,
        expires_at: error.expiresAt ?? null,
        accepted_commands: acceptedCommands,
      },
    });
    return;
  }

  const notFoundMessages = translatedMessageSet(t, NOT_FOUND_KEYS);
  if (notFoundMessages.has(message) || RAW_NOT_FOUND_MESSAGES.has(message)) {
    sendResponse(reply, {
      message:
        message === 'message_chat_mismatch' ||
        message === t('message_chat_mismatch')
          ? t('message_not_found')
          : message,
      httpStatusCode: EHTTPStatusCode.not_found,
    });
    return;
  }

  const forbiddenMessages = translatedMessageSet(t, FORBIDDEN_KEYS);
  if (forbiddenMessages.has(message)) {
    sendResponse(reply, {
      message,
      httpStatusCode: EHTTPStatusCode.forbidden,
    });
    return;
  }

  const badRequestMessages = translatedMessageSet(t, BAD_REQUEST_KEYS);
  if (
    badRequestMessages.has(message) ||
    RAW_BAD_REQUEST_MESSAGES.has(message)
  ) {
    sendResponse(reply, {
      message,
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
    return;
  }

  handleControllerError(error, reply, t);
}
