import 'reflect-metadata';
import { resolveWorkerRuntimeKafkaHealthState } from '@core/common/functions/workerRuntimeKafkaHealth';

describe('worker connection gRPC runtime Kafka health', () => {
  it('does not classify intentionally stopped standby consumers as unhealthy', () => {
    expect(
      resolveWorkerRuntimeKafkaHealthState({
        standby: true,
        activated: false,
        kafkaUnhealthy: true,
      })
    ).toEqual({
      kafkaUnhealthy: false,
      kafkaConsumersReady: false,
    });
  });

  it('restores the strict Kafka gate after runtime activation', () => {
    expect(
      resolveWorkerRuntimeKafkaHealthState({
        standby: false,
        activated: true,
        kafkaUnhealthy: true,
      })
    ).toEqual({
      kafkaUnhealthy: true,
      kafkaConsumersReady: false,
    });

    expect(
      resolveWorkerRuntimeKafkaHealthState({
        standby: false,
        activated: true,
        kafkaUnhealthy: false,
      })
    ).toEqual({
      kafkaUnhealthy: false,
      kafkaConsumersReady: true,
    });
  });
});
