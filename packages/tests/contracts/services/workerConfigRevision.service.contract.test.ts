import 'reflect-metadata';
import Redis from 'ioredis';
import { WorkerConfigRevisionService } from '@core/services/workerConfigRevision.service';

class MemoryRedis {
  readonly values = new Map<string, string>();

  async eval(
    script: string,
    _keyCount: number,
    ...args: Array<string | number>
  ): Promise<number> {
    if (script.includes('incoming < current')) {
      const [currentKey, rawRevision] = args.map(String);
      const incoming = Number(rawRevision);
      const current = Number(this.values.get(currentKey) ?? 0);
      if (incoming <= 0 || incoming < current) {
        return 0;
      }
      if (incoming > current) {
        this.values.set(currentKey, rawRevision);
      }
      return 1;
    }

    const [currentKey, legacyAppliedKey, rawRevision] = args.map(String);
    if (!rawRevision) {
      return !this.values.has(currentKey) && !this.values.has(legacyAppliedKey)
        ? 1
        : 0;
    }
    const incoming = Number(rawRevision);
    const current = Number(this.values.get(currentKey) ?? 0);
    return incoming > 0 && current === incoming ? 1 : 0;
  }
}

describe('WorkerConfigRevisionService', () => {
  it('shares the current revision across pods and providers without consuming it', async () => {
    const redis = new MemoryRedis();
    const producer = new WorkerConfigRevisionService(redis as never as Redis);
    const baileys = new WorkerConfigRevisionService(redis as never as Redis);
    const wwebjs = new WorkerConfigRevisionService(redis as never as Redis);

    await producer.registerCurrent('worker-1', '1777777777000000');
    await expect(
      baileys.isCurrent('worker-1', '1777777776999999')
    ).resolves.toBe(false);
    await expect(
      baileys.isCurrent('worker-1', '1777777777000000')
    ).resolves.toBe(true);
    await expect(
      wwebjs.isCurrent('worker-1', '1777777777000000')
    ).resolves.toBe(true);
    await expect(wwebjs.isCurrent('worker-1')).resolves.toBe(false);
  });

  it('accepts legacy events only before any revision protocol marker exists', async () => {
    const redis = new MemoryRedis();
    const service = new WorkerConfigRevisionService(redis as never as Redis);

    await expect(service.isCurrent('worker-legacy')).resolves.toBe(true);
    redis.values.set(
      WorkerConfigRevisionService.legacyAppliedKey('worker-legacy'),
      '1777777776999999'
    );
    await expect(service.isCurrent('worker-legacy')).resolves.toBe(false);
    redis.values.delete(
      WorkerConfigRevisionService.legacyAppliedKey('worker-legacy')
    );
    await service.registerCurrent('worker-legacy', '1777777777000000');
    await expect(service.isCurrent('worker-legacy')).resolves.toBe(false);
  });

  it('does not acknowledge the revision before the idempotent local setter runs', async () => {
    const redis = new MemoryRedis();
    const firstAttempt = new WorkerConfigRevisionService(
      redis as never as Redis
    );
    const retry = new WorkerConfigRevisionService(redis as never as Redis);

    await firstAttempt.registerCurrent('worker-1', '1777777777000000');
    await expect(
      firstAttempt.isCurrent('worker-1', '1777777777000000')
    ).resolves.toBe(true);
    await expect(retry.isCurrent('worker-1', '1777777777000000')).resolves.toBe(
      true
    );
  });

  it('does not let a delayed producer regress the canonical revision', async () => {
    const redis = new MemoryRedis();
    const service = new WorkerConfigRevisionService(redis as never as Redis);

    await service.registerCurrent('worker-1', '1777777777000002');
    await expect(
      service.registerCurrent('worker-1', '1777777777000001')
    ).rejects.toThrow('worker_config_revision_regression');
    await expect(
      service.isCurrent('worker-1', '1777777777000001')
    ).resolves.toBe(false);
    await expect(
      service.isCurrent('worker-1', '1777777777000002')
    ).resolves.toBe(true);
  });
});
