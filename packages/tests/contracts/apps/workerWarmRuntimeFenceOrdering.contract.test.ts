import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BaileysEnvironment } from '@core/config/environments/BaileysEnvironment';
import { WwebjsEnvironment } from '@core/config/environments/WwebjsEnvironment';

const projectRoot = resolve(__dirname, '../../../..');

describe('PostgreSQL warm runtime cutover boundary', () => {
  const relevantEnvKeys = [
    'WORKER_ID',
    'ACCOUNT_ID',
    'RUNTIME_GENERATION',
    'WORKER_SESSION_STORAGE',
    'WORKER_RUNTIME_CAPABILITY',
    'WORKER_WRITER_EPOCH',
    'WARM_POOL_ID',
    'WARM_STANDBY',
    'NATS_CREDS_BASE64',
    'NATS_USER',
    'NATS_PASSWORD',
    'NATS_TOKEN',
    'APP_ENVIRONMENT',
  ] as const;
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of relevantEnvKeys) original.set(key, process.env[key]);
    delete process.env.WORKER_ID;
    delete process.env.ACCOUNT_ID;
    delete process.env.RUNTIME_GENERATION;
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    process.env.WORKER_RUNTIME_CAPABILITY = 'c'.repeat(48);
    process.env.WORKER_WRITER_EPOCH = '018f0000-0000-7000-8000-000000000001';
    process.env.WARM_POOL_ID = '018f0000-0000-7000-8000-000000000002';
    process.env.WARM_STANDBY = 'true';
    process.env.APP_ENVIRONMENT = 'PROD';
    process.env.NATS_USER = 'runtime-user';
    process.env.NATS_PASSWORD = 'runtime-password';
    delete process.env.NATS_TOKEN;
    delete process.env.NATS_CREDS_BASE64;
  });

  afterEach(() => {
    for (const key of relevantEnvKeys) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each([
    ['baileys', () => new BaileysEnvironment()],
    ['wwebjs', () => new WwebjsEnvironment()],
  ])(
    'rejects a mismatched %s capability without mutating standby',
    (_, make) => {
      const environment = make();
      expect(() =>
        environment.validateRuntimeActivation({
          worker_id: '018f0000-0000-7000-8000-000000000003',
          account_id: '018f0000-0000-7000-8000-000000000004',
          worker_type_id: 'provider',
          warm_pool_id: process.env.WARM_POOL_ID,
          runtime_generation: 2,
          session_storage: 'postgres',
          runtime_capability: 'd'.repeat(48),
          writer_epoch: process.env.WORKER_WRITER_EPOCH,
        })
      ).toThrow('PostgreSQL warm runtime activation identity is invalid');
      expect(process.env.WARM_STANDBY).toBe('true');
      expect(process.env.WORKER_ID).toBeUndefined();
      expect(process.env.ACCOUNT_ID).toBeUndefined();
      expect(process.env.RUNTIME_GENERATION).toBeUndefined();
    }
  );

  it.each([
    ['baileys', () => new BaileysEnvironment()],
    ['wwebjs', () => new WwebjsEnvironment()],
  ])(
    'keeps the inherited static NATS user/password while activating %s',
    (_, make) => {
      const environment = make();

      environment.activateRuntime({
        worker_id: '018f0000-0000-7000-8000-000000000003',
        account_id: '018f0000-0000-7000-8000-000000000004',
        worker_type_id: 'provider',
        warm_pool_id: process.env.WARM_POOL_ID,
        runtime_generation: 2,
        session_storage: 'postgres',
        runtime_capability: process.env.WORKER_RUNTIME_CAPABILITY,
        writer_epoch: process.env.WORKER_WRITER_EPOCH,
      });

      expect(process.env.NATS_USER).toBe('runtime-user');
      expect(process.env.NATS_PASSWORD).toBe('runtime-password');
      expect(process.env.NATS_TOKEN).toBeUndefined();
      expect(process.env.NATS_CREDS_BASE64).toBeUndefined();
      expect(process.env.WARM_STANDBY).toBe('false');
    }
  );

  it('orders validation and durable fence before committing environment/provider effects', () => {
    const source = readFileSync(
      resolve(
        projectRoot,
        'packages/plugins/proto/workerConnectionGrpcServer.ts'
      ),
      'utf8'
    );
    const handler = source.slice(source.indexOf('const handleActivateRuntime'));
    const validateAt = handler.indexOf('validateEnvironmentActivation(req)');
    const fenceAt = handler.indexOf('await activateWorkerRuntimeFence');
    const commitAt = handler.indexOf('const activation = activateEnvironment');
    const bootstrapAt = handler.indexOf('options?.activateRuntime?.');
    expect(validateAt).toBeGreaterThanOrEqual(0);
    expect(fenceAt).toBeGreaterThan(validateAt);
    expect(commitAt).toBeGreaterThan(fenceAt);
    expect(bootstrapAt).toBeGreaterThan(commitAt);
  });

  it('renames and activates the immutable warm container without deleting it', () => {
    const source = readFileSync(
      resolve(projectRoot, 'packages/services/workerCommandHandler.service.ts'),
      'utf8'
    );
    const start = source.indexOf('private async activatePostgresWarmWorker');
    const end = source.indexOf(
      'private assertPostgresReusableWarmContainerIdentity',
      start
    );
    const activation = source.slice(start, end);
    expect(activation).toContain('renameContainer(');
    expect(activation).toContain('.activateRuntime(');
    expect(activation.indexOf('renameContainer(')).toBeLessThan(
      activation.indexOf('.activateRuntime(')
    );
    expect(activation).not.toContain(
      'removeContainerWorkerById(sourceContainerId)'
    );
  });
});
