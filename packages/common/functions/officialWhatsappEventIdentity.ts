import { buildMessageStatusEventId } from './messageStatusIdentity';

export function buildOfficialWhatsappMessageStatusEventId(input: {
  accountId: string;
  workerId: string;
  providerMessageId: string;
  status: string;
}): string {
  const status = input.status.trim().toLowerCase();
  const failed = status === 'failed';
  const patch =
    status === 'read' || status === 'seen'
      ? { is_seen: true }
      : status === 'delivered'
        ? { is_delivered: true }
        : status === 'sent'
          ? { is_sent: true }
          : {};
  const eventId = buildMessageStatusEventId({
    account_id: input.accountId,
    worker_id: input.workerId,
    message_id: input.providerMessageId,
    patch,
    failed,
  });
  if (!eventId) {
    throw new TypeError('Invalid official WhatsApp message status identity');
  }

  return eventId;
}
