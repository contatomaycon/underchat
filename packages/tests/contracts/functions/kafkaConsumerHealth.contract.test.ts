import {
  buildMissingKafkaConsumerHealthSnapshot,
  getConsumerOwnerKafkaHealthSnapshot,
} from '@core/common/functions/kafkaConsumerHealth';

describe('kafkaConsumerHealth', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('treats an expected consumer without health snapshot as unhealthy after grace', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-27T13:40:00.000Z'));

    const registeredAt = Date.now() - 120_000;
    const snapshot = buildMissingKafkaConsumerHealthSnapshot({
      owner: 'MessageSendConsume',
      registeredAt,
      graceMs: 60_000,
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        owner: 'MessageSendConsume',
        connected: false,
        consuming: false,
        missing: true,
        unhealthy: true,
        pending_count: 0,
        pending_queued_count: 0,
        pending_processing_count: 0,
        pending_settled_count: 0,
        oldest_pending_no_progress_age_ms: 0,
        stall_reason: 'missing_consumer_health_snapshot',
        last_error: 'missing_consumer_health_snapshot',
      })
    );
  });

  it('does not invent a healthy snapshot for owners without managed consumer health', () => {
    expect(getConsumerOwnerKafkaHealthSnapshot({ consumer: null })).toBeNull();
  });
});
