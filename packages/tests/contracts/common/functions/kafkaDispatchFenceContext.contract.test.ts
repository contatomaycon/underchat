import {
  assertKafkaDispatchActive,
  getKafkaDispatchGuard,
  runWithKafkaDispatchGuard,
  runWithoutKafkaDispatchGuard,
} from '@core/common/functions/kafkaDispatchFenceContext';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';

describe('kafkaDispatchFenceContext', () => {
  it('keeps the Kafka guard in ordinary async work', async () => {
    const guard = jest.fn(() => {
      throw new KafkaConsumerDispatchRevokedError();
    });

    await expect(
      runWithKafkaDispatchGuard(guard, () => assertKafkaDispatchActive())
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);
    expect(guard).toHaveBeenCalledTimes(1);
  });

  it('does not leak an event-scoped Kafka guard into deferred work', async () => {
    const guard = jest.fn(() => {
      throw new KafkaConsumerDispatchRevokedError();
    });

    await runWithKafkaDispatchGuard(
      guard,
      () =>
        new Promise<void>((resolve, reject) => {
          runWithoutKafkaDispatchGuard(() => {
            setImmediate(() => {
              void assertKafkaDispatchActive()
                .then(() => {
                  expect(getKafkaDispatchGuard()).toBeUndefined();
                  resolve();
                })
                .catch(reject);
            });
          });
        })
    );

    expect(guard).not.toHaveBeenCalled();
  });
});
