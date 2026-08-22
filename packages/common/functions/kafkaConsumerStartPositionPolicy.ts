import type { KafkaConsumerStartPosition } from '@core/plugins/kafkaStreams';

/**
 * Operational WhatsApp topics resume from a valid committed offset. The
 * native client's missing/invalid-offset fallback is configured separately
 * as `latest`, so a lost group never replays retained history.
 */
export const WHATSAPP_DURABLE_COMMITTED_TOPICS = Object.freeze([
  'upsert.message',
  'upsert.message.history',
  'update.message',
  'update.message.status',
  'user.phone.jid.update',
  'phone.validation.response',
  'contact.validation.update',
  'update.profile.status.external.id',
  'notification.message',
  'official.whatsapp.send.message',
  'official.whatsapp.webhook.event',
  'clear.chat.summary',
  'schedule.status.update',
] as const);

const whatsappDurableCommittedTopics = new Set<string>(
  WHATSAPP_DURABLE_COMMITTED_TOPICS
);

export function isWhatsappDurableCommittedTopic(topic: string): boolean {
  return whatsappDurableCommittedTopics.has(topic);
}

export function resolveKafkaConsumerStartPosition(
  topic: string,
  requestedStartPosition?: KafkaConsumerStartPosition
): KafkaConsumerStartPosition | undefined {
  if (isWhatsappDurableCommittedTopic(topic)) {
    return 'committed';
  }

  // Assignment-time seeking is intentionally retired. The only supported
  // high-watermark transition is the explicit, tokenized one-time bootstrap
  // barrier, which commits group offsets before normal consumers start.
  return requestedStartPosition === 'latest-on-assignment'
    ? 'committed'
    : requestedStartPosition;
}
