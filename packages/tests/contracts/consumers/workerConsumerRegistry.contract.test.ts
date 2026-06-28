describe('worker consumer registry', () => {
  it.each([
    ['baileys', '../../../../apps/worker_baileys/src/consumer/registry'],
    ['wwebjs', '../../../../apps/worker_wwebjs/src/consumer/registry'],
  ])(
    'keeps %s non-Kafka consumers out of Kafka health checks',
    (_provider, modulePath) => {
      jest.isolateModules(() => {
        const registry = require(modulePath) as {
          registerWorkerConsumer: (
            consumer: unknown,
            options?: { monitorKafkaHealth?: boolean }
          ) => void;
          getWorkerConsumers: () => unknown[];
          getKafkaConsumerHealthSnapshots: () => unknown[];
          hasUnhealthyKafkaConsumer: () => boolean;
        };

        const qrConsumer = {
          execute: jest.fn(async () => undefined),
          close: jest.fn(async () => undefined),
        };

        registry.registerWorkerConsumer(qrConsumer, {
          monitorKafkaHealth: false,
        });

        expect(registry.getWorkerConsumers()).toContain(qrConsumer);
        expect(registry.getKafkaConsumerHealthSnapshots()).toEqual([]);
        expect(registry.hasUnhealthyKafkaConsumer()).toBe(false);
      });
    }
  );
});
