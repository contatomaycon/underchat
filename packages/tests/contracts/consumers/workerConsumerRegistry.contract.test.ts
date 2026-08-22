export {};

interface RegistryModule {
  EXPECTED_KAFKA_CONSUMER_COUNT: number;
  registerWorkerConsumer: (
    consumer: unknown,
    options?: { monitorKafkaHealth?: boolean }
  ) => void;
  getWorkerConsumers: () => unknown[];
  getKafkaConsumerHealthSnapshots: () => unknown[];
  getKafkaConsumerHealthSummary: () => {
    expected: number;
    active: number;
    missing: number;
    unhealthy: number;
  };
  areKafkaConsumersReady: () => boolean;
  hasUnhealthyKafkaConsumer: () => boolean;
}

const registryModules = [
  ['baileys', '../../../../apps/worker_baileys/src/consumer/registry'],
  ['wwebjs', '../../../../apps/worker_wwebjs/src/consumer/registry'],
] as const;

function loadRegistry(modulePath: string): RegistryModule {
  return require(modulePath) as RegistryModule;
}

function buildReadyConsumer(index: number) {
  const topic = `uc.worker.command.worker-${index}`;
  return {
    consumer: {
      __health: () => ({
        group_id: `uc_worker_${index}`,
        assignments_ready: true,
        dispatch_authorized: true,
        topics: [topic],
        connected: true,
        consuming: true,
        unhealthy: false,
        restart_count: 0,
        last_message_at: 0,
        last_commit_at: 0,
        last_restart_at: 0,
        last_error: '',
      }),
    },
  };
}

describe('worker consumer registry', () => {
  it.each(registryModules)(
    'fails closed with no registered %s command ingress',
    (_provider, modulePath) => {
      jest.isolateModules(() => {
        const registry = loadRegistry(modulePath);

        expect(registry.EXPECTED_KAFKA_CONSUMER_COUNT).toBe(1);
        expect(registry.getKafkaConsumerHealthSummary()).toEqual({
          expected: 1,
          active: 0,
          missing: 1,
          unhealthy: 0,
        });
        expect(registry.areKafkaConsumersReady()).toBe(false);
        expect(registry.hasUnhealthyKafkaConsumer()).toBe(true);
      });
    }
  );

  it.each(registryModules)(
    'keeps %s non-Kafka consumers out of Kafka health checks',
    (_provider, modulePath) => {
      jest.isolateModules(() => {
        const registry = loadRegistry(modulePath);

        const qrConsumer = {
          execute: jest.fn(async () => undefined),
          close: jest.fn(async () => undefined),
        };

        registry.registerWorkerConsumer(qrConsumer, {
          monitorKafkaHealth: false,
        });

        expect(registry.getWorkerConsumers()).toContain(qrConsumer);
        expect(registry.getKafkaConsumerHealthSnapshots()).toEqual([]);
        expect(registry.getKafkaConsumerHealthSummary()).toEqual({
          expected: 1,
          active: 0,
          missing: 1,
          unhealthy: 0,
        });
        expect(registry.areKafkaConsumersReady()).toBe(false);
        expect(registry.hasUnhealthyKafkaConsumer()).toBe(true);
      });
    }
  );

  it.each(registryModules)(
    'marks %s ready only with its JetStream command ingress active',
    (_provider, modulePath) => {
      jest.isolateModules(() => {
        const registry = loadRegistry(modulePath);

        Array.from({ length: 1 }, (_, index) =>
          buildReadyConsumer(index)
        ).forEach((consumer) => registry.registerWorkerConsumer(consumer));

        expect(registry.getKafkaConsumerHealthSummary()).toEqual({
          expected: 1,
          active: 1,
          missing: 0,
          unhealthy: 0,
        });
        expect(registry.areKafkaConsumersReady()).toBe(true);
        expect(registry.hasUnhealthyKafkaConsumer()).toBe(false);
      });
    }
  );
});
