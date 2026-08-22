import { resolveKafkaConsumerDisconnectBudget } from '@core/common/functions/kafkaConsumerDisconnectBudget';

describe('resolveKafkaConsumerDisconnectBudget', () => {
  it('keeps wrapper shutdown strictly wider than the native minimum', () => {
    expect(
      resolveKafkaConsumerDisconnectBudget({
        KAFKA_CONSUMER_DISCONNECT_TIMEOUT_MS: '5000',
      })
    ).toEqual({
      nativeTimeoutMs: 15_000,
      wrapperTimeoutMs: 20_000,
    });
  });

  it('derives the wrapper deadline from an optional larger override', () => {
    expect(
      resolveKafkaConsumerDisconnectBudget({
        KAFKA_CONSUMER_DISCONNECT_TIMEOUT_MS: '30000',
      })
    ).toEqual({
      nativeTimeoutMs: 30_000,
      wrapperTimeoutMs: 35_000,
    });
  });

  it('uses safe defaults when the optional override is absent or invalid', () => {
    expect(resolveKafkaConsumerDisconnectBudget({})).toEqual({
      nativeTimeoutMs: 15_000,
      wrapperTimeoutMs: 20_000,
    });
    expect(
      resolveKafkaConsumerDisconnectBudget({
        KAFKA_CONSUMER_DISCONNECT_TIMEOUT_MS: 'invalid',
      })
    ).toEqual({
      nativeTimeoutMs: 15_000,
      wrapperTimeoutMs: 20_000,
    });
  });
});
