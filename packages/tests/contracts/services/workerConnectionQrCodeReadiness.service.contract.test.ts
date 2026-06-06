import 'reflect-metadata';

jest.mock('@core/plugins/telemetry/connectionLifecycleDebug', () => ({
  recordConnectionLifecycle: jest.fn(),
}));

import { WorkerConnectionQrCodeReadinessService } from '@core/services/workerConnectionQrCodeReadiness.service';

function makeRedis() {
  const store = new Map<string, string>();

  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(
      async (key: string, value: string, _mode: string, ttl: number) => {
        store.set(key, value);
        return ttl > 0 ? 'OK' : null;
      }
    ),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
}

async function flushPromises(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

const input = {
  worker_id: 'worker-1',
  account_id: 'account-1',
  worker_type_id: 'baileys',
  topic: 'worker.worker-1.connection.qrcode',
  group_id: 'group-underchat-baileys-connection-qrcode-worker-1',
};

describe('WorkerConnectionQrCodeReadinessService', () => {
  it('marks the QR consumer ready when the health gate is healthy', async () => {
    const redis = makeRedis();
    const service = new WorkerConnectionQrCodeReadinessService(redis as never);

    const stop = service.startHeartbeat(input, {
      isHealthy: () => true,
    });
    await flushPromises();
    stop();

    expect(redis.set).toHaveBeenCalledWith(
      'worker:worker-1:connection:qrcode:consumer:ready',
      expect.stringContaining('"group_id"'),
      'EX',
      WorkerConnectionQrCodeReadinessService.TTL_SECONDS
    );
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('clears QR consumer readiness when the health gate is not healthy', async () => {
    const redis = makeRedis();
    redis.store.set(
      'worker:worker-1:connection:qrcode:consumer:ready',
      JSON.stringify(input)
    );
    const service = new WorkerConnectionQrCodeReadinessService(redis as never);

    const stop = service.startHeartbeat(input, {
      isHealthy: () => false,
    });
    await flushPromises();
    stop();

    expect(redis.del).toHaveBeenCalledWith(
      'worker:worker-1:connection:qrcode:consumer:ready'
    );
    expect(redis.set).not.toHaveBeenCalled();
  });
});
