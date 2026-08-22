import {
  isWhatsappDurableCommittedTopic,
  resolveKafkaConsumerStartPosition,
  WHATSAPP_DURABLE_COMMITTED_TOPICS,
} from '@core/common/functions/kafkaConsumerStartPositionPolicy';
import { SERVICE_API_WHATSAPP_CONSUMER_BINDINGS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';

describe('Kafka consumer start-position policy', () => {
  const expectedTopics = [
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
  ] as const;

  it('covers every WhatsApp pipeline topic that must preserve prior backlog', () => {
    expect(WHATSAPP_DURABLE_COMMITTED_TOPICS).toEqual(expectedTopics);
    expect(new Set(WHATSAPP_DURABLE_COMMITTED_TOPICS).size).toBe(
      expectedTopics.length
    );
  });

  it('keeps every durable topic paired with a protected stable consumer group', () => {
    expect(
      new Set(SERVICE_API_WHATSAPP_CONSUMER_BINDINGS.map(({ topic }) => topic))
    ).toEqual(new Set(WHATSAPP_DURABLE_COMMITTED_TOPICS));
  });

  it.each(expectedTopics)(
    'forces committed offsets for %s even when assignment-latest is requested',
    (topic) => {
      expect(isWhatsappDurableCommittedTopic(topic)).toBe(true);
      expect(resolveKafkaConsumerStartPosition(topic)).toBe('committed');
      expect(resolveKafkaConsumerStartPosition(topic, 'committed')).toBe(
        'committed'
      );
      expect(
        resolveKafkaConsumerStartPosition(topic, 'latest-on-assignment')
      ).toBe('committed');
    }
  );

  it('does not classify retired per-worker command topics as Kafka consumers', () => {
    expect(
      isWhatsappDurableCommittedTopic('worker.worker-1.send.message')
    ).toBe(false);
    expect(
      resolveKafkaConsumerStartPosition(
        'worker.worker-1.send.message',
        'latest-on-assignment'
      )
    ).toBe('committed');
  });

  it('defaults other topics normally but retires assignment-time latest requests', () => {
    expect(
      isWhatsappDurableCommittedTopic('internal.chat.direct.message')
    ).toBe(false);
    expect(
      resolveKafkaConsumerStartPosition('internal.chat.direct.message')
    ).toBeUndefined();
    expect(
      resolveKafkaConsumerStartPosition(
        'internal.chat.direct.message',
        'committed'
      )
    ).toBe('committed');
    expect(
      resolveKafkaConsumerStartPosition(
        'internal.chat.direct.message',
        'latest-on-assignment'
      )
    ).toBe('committed');
  });
});
