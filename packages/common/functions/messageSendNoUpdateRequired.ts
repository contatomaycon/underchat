import { EMessageType } from '../enums/EMessageType';
import type { IChatMessage } from '../interfaces/IChatMessage';
import {
  resolveMessageSendIdentity,
  resolveMessageSendOperationId,
} from './messageIdentity';

export const MESSAGE_SEND_NO_UPDATE_REQUIRED_SCHEMA =
  'message_send_no_update_required_v1' as const;

export type MessageSendNoUpdateProvider = 'baileys' | 'wwebjs';
export type MessageSendNoUpdateOperationKind =
  EMessageType.delete_message | EMessageType.react;

export interface IMessageSendNoUpdateRequiredResult {
  no_update_required: {
    schema_version: typeof MESSAGE_SEND_NO_UPDATE_REQUIRED_SCHEMA;
    provider: MessageSendNoUpdateProvider;
    operation_kind: MessageSendNoUpdateOperationKind;
    operation_id: string;
    account_id: string;
    worker_id: string;
    chat_id: string;
    message_id: string;
  };
}

function resolveNoUpdateOperationKind(
  payload: IChatMessage,
  provider: MessageSendNoUpdateProvider
): MessageSendNoUpdateOperationKind | null {
  const operationKind = payload.content?.type;
  if (operationKind === EMessageType.delete_message) {
    return operationKind;
  }
  if (provider === 'wwebjs' && operationKind === EMessageType.react) {
    return operationKind;
  }
  return null;
}

export function buildMessageSendNoUpdateRequiredResult(
  payload: IChatMessage,
  provider: MessageSendNoUpdateProvider,
  expectedWorkerId: string
): IMessageSendNoUpdateRequiredResult | null {
  const identity = resolveMessageSendIdentity(payload);
  const operationId = resolveMessageSendOperationId(payload);
  const operationKind = resolveNoUpdateOperationKind(payload, provider);
  const workerId = payload.worker?.id?.trim();
  expectedWorkerId = expectedWorkerId.trim();
  if (
    !identity ||
    !operationId ||
    !operationKind ||
    !workerId ||
    !expectedWorkerId ||
    workerId !== expectedWorkerId
  ) {
    return null;
  }

  return {
    no_update_required: {
      schema_version: MESSAGE_SEND_NO_UPDATE_REQUIRED_SCHEMA,
      provider,
      operation_kind: operationKind,
      operation_id: operationId,
      account_id: identity.accountId,
      worker_id: workerId,
      chat_id: identity.chatId,
      message_id: identity.messageId,
    },
  };
}

export function isMessageSendNoUpdateRequiredResult(
  result: unknown,
  expectedPayload: IChatMessage,
  provider: MessageSendNoUpdateProvider,
  expectedWorkerId: string
): result is IMessageSendNoUpdateRequiredResult {
  const expected = buildMessageSendNoUpdateRequiredResult(
    expectedPayload,
    provider,
    expectedWorkerId
  );
  if (!expected || !result || typeof result !== 'object') {
    return false;
  }

  const actual = (result as Partial<IMessageSendNoUpdateRequiredResult>)
    .no_update_required;
  const expectedMarker = expected.no_update_required;
  return (
    actual?.schema_version === expectedMarker.schema_version &&
    actual.provider === expectedMarker.provider &&
    actual.operation_kind === expectedMarker.operation_kind &&
    actual.operation_id === expectedMarker.operation_id &&
    actual.account_id === expectedMarker.account_id &&
    actual.worker_id === expectedMarker.worker_id &&
    actual.chat_id === expectedMarker.chat_id &&
    actual.message_id === expectedMarker.message_id
  );
}
