import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(root, relativePath), 'utf8');
}

function methodBody(source: string, methodName: string): string {
  const start = source.indexOf(`  async ${methodName}(`);
  if (start < 0) {
    throw new Error(`method ${methodName} was not found`);
  }
  const next = source.indexOf('\n  async ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

function productionGoSources(relativeDirectory: string): string {
  const directory = path.resolve(root, relativeDirectory);
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.go'))
    .filter((entry) => !entry.name.endsWith('_test.go'))
    .map((entry) => fs.readFileSync(path.join(directory, entry.name), 'utf8'))
    .join('\n');
}

describe('direct worker runtime access', () => {
  it('keeps the removed internal service route absent and unregistered', () => {
    expect(
      fs.existsSync(
        path.resolve(
          root,
          'apps/service_api/src/routes/internalWorkerRuntime.route.ts'
        )
      )
    ).toBe(false);

    const routeIndex = read('apps/service_api/src/routes/index.ts');
    const serviceIndex = read('apps/service_api/src/index.ts');
    expect(routeIndex).not.toMatch(
      /internalWorkerRuntime|internal-worker-runtime/u
    );
    expect(serviceIndex).not.toMatch(
      /internalWorkerRuntime|internal-worker-runtime/u
    );
    expect(routeIndex).toContain('server.register(healthRoutes)');
  });

  it('uses PostgreSQL directly for every Node worker data operation', () => {
    const adapter = read(
      'packages/services/balanceWorkerStatusGrpcClient.service.ts'
    );
    const directMethods = [
      'activateWhatsappRuntimeFence',
      'notifyWorkerStatus',
      'publishWorkerRuntimeEvent',
      'registerS3BackupFallbackUpload',
      'requestWorkerSelfHealing',
      'resolveIncomingCallAction',
      'getTypingSimulationConfig',
    ] as const;

    for (const method of directMethods) {
      const body = methodBody(adapter, method);
      expect(body).toContain(`workerRuntimeDatabaseService.${method}`);
      expect(body).not.toContain('this.createClient()');
      expect(body).not.toMatch(/WorkerCommand\./u);
    }

    const legacyCleanup = methodBody(adapter, 'authorizeChromiumLockCleanup');
    expect(legacyCleanup).toContain('this.createClient()');

    const directService = read(
      'packages/services/workerRuntimeDatabase.service.ts'
    );
    for (const sqlContract of [
      'activate_whatsapp_runtime_fence',
      'apply_worker_runtime_status',
      'request_worker_self_heal',
      'read_whatsapp_worker_typing_config',
      'register_whatsapp_worker_s3_backup',
    ]) {
      expect(directService).toContain(sqlContract);
    }
    expect(directService).toContain("await import('./chat.service')");
    expect(directService).not.toMatch(/SERVICE_API|fetch\(|axios\./u);
  });

  it.each(['worker_baileys', 'worker_wwebjs'])(
    '%s registers direct PostgreSQL, Elasticsearch and Redis dependencies',
    (worker) => {
      const source = read(`apps/${worker}/src/index.ts`);
      expect(source).toContain(
        "safePlugin(databaseElasticPlugin, 'databaseElastic')"
      );
      expect(source).toContain(
        "safePlugin(workerDatabasePlugin, 'workerDatabase')"
      );
      expect(source).toContain("safePlugin(redisPlugin, 'redis')");
    }
  );

  it('keeps a single small Node pool without logging its connection string', () => {
    const pool = read('packages/services/workerPostgresPool.ts');
    expect(pool).toContain('min: 0');
    expect(pool).toContain('max: 2');
    expect(pool).toContain('process.env.WORKER_DATABASE_URL?.trim()');
    expect(pool).toContain('getWorkerScopedPostgresPool');
    expect(pool).toContain('begin_whatsapp_worker_operation');
    expect(pool).toContain("await client.query('BEGIN')");
    expect(pool).toContain("await client.query('COMMIT')");
    expect(pool).toContain(
      "pool.on('connect', installWorkerPostgresQueryProtocol)"
    );
    expect(pool).not.toMatch(/console\.|\.log\(/u);

    const plugin = read('packages/plugins/workerDatabase/index.ts');
    expect(plugin).toContain('drizzle(getWorkerScopedPostgresPool()');
  });

  it('removes every Whatsmeow worker-to-Balance data proxy', () => {
    const go = productionGoSources('apps/worker_whatsmeow/internal/app');
    expect(go).not.toContain('BalanceGRPCClient');
    expect(go).not.toContain('/worker_command.WorkerCommand/');
    expect(go).not.toMatch(
      /\.balance\.(?:Get|Request|Register|Resolve|Activate)/u
    );
    expect(go).toContain('postgres.ApplyWorkerStatus');
    expect(go).toContain('postgres.ActivateRuntimeFence');
    expect(go).toContain('$5::uuid, $6, $7, $8::uuid');
    expect(go).toContain('identity.Container');
    expect(go).toContain('w.postgres.RequestSelfHealing');
    expect(go).toContain('m.postgres.GetTypingSimulationConfig');
    expect(go).toContain('m.postgres.ResolveIncomingCallAction');
    expect(go).toContain('s.postgres.RegisterS3BackupFallbackUpload');
    expect(go).toContain(
      'RegisterS3BackupFallbackUpload(accountingCtx, s.cfg, payload)'
    );
    expect(go).toContain('begin_whatsapp_worker_operation');
    expect(go).toContain('read_whatsapp_worker_typing_config');
    expect(go).toContain('read_whatsapp_worker_call_config');
    expect(go).toContain('register_whatsapp_worker_s3_backup');
    expect(go).toContain('worker runtime database fence rejected');
    expect(go).toContain(
      'worker database URL is required for runtime fence and status outbox'
    );
    expect(go).toContain('db.SetMaxOpenConns(workerDatabaseMaxConnections)');
    expect(go).toContain('db.SetMaxIdleConns(1)');
    expect(go).toContain('acquire_whatsapp_session_lease');
    expect(go).toContain('renew_whatsapp_session_lease');
    expect(go).toContain('release_whatsapp_session_lease');
    expect(go).toContain('whatsappSessionLeaseTTL');
    expect(go).not.toContain('pg_try_advisory_lock');
    expect(go).not.toContain('db.SetMaxIdleConns(0)');
  });

  it('keeps direct Whatsmeow operational errors out of logs', () => {
    const safeError = read(
      'apps/worker_whatsmeow/internal/app/safe_error_log.go'
    );
    expect(safeError).toContain('func safeOperationalErrorCode(err error)');
    expect(safeError).not.toContain('err.Error()');

    for (const relativePath of [
      'apps/worker_whatsmeow/internal/app/grpc_bridge.go',
      'apps/worker_whatsmeow/internal/app/postgres.go',
      'apps/worker_whatsmeow/internal/app/runtime_fence.go',
      'apps/worker_whatsmeow/internal/app/s3.go',
      'apps/worker_whatsmeow/internal/app/self_monitor.go',
      'apps/worker_whatsmeow/internal/app/typing_simulation.go',
      'apps/worker_whatsmeow/internal/app/whatsmeow_postgres_import.go',
    ]) {
      const source = read(relativePath);
      expect(source).not.toMatch(/log\.Printf\([^\n]*error=%v/u);
    }

    const grpcBridge = read(
      'apps/worker_whatsmeow/internal/app/grpc_bridge.go'
    );
    expect(grpcBridge).not.toContain('err.Error()');
    expect(grpcBridge).toContain('safeOperationalErrorCode(err)');
  });

  it('scopes Balance credentials to legacy WWebJS Chromium cleanup only', () => {
    const workerService = read('packages/services/worker.service.ts');
    expect(workerService).toContain('needsLegacyWwebjsBalancerAccess');
    expect(workerService).toContain(
      "envMap.get('WORKER_TYPE_ID') === EWorkerType.wwebjs"
    );
    expect(workerService).toContain('EWorkerSessionStorage.legacy_volume');
    expect(workerService).toContain("envMap.delete('BALANCER_GRPC_HOST')");
    expect(workerService).toContain("envMap.delete('BALANCER_GRPC_PORT')");

    const baileysIndex = read('apps/worker_baileys/src/index.ts');
    const wwebjsIndex = read('apps/worker_wwebjs/src/index.ts');
    expect(baileysIndex).not.toContain('balancerRuntimeFenceToken');
    expect(wwebjsIndex).toContain("===\n  'legacy_volume'");
    expect(wwebjsIndex).toContain('balancerRuntimeFenceToken()');
  });

  it('never logs the Baileys passkey response or database credentials', () => {
    const baileysConnection = read(
      'packages/services/baileys/methods/connection.service.ts'
    );
    expect(baileysConnection).not.toMatch(
      /^\s*passkey_response:\s*input\.passkey_response/mu
    );
    expect(baileysConnection).toContain(
      'has_passkey_response: input.passkey_response.length > 0'
    );

    for (const source of [
      read('packages/services/workerPostgresPool.ts'),
      read('packages/services/workerRuntimeDatabase.service.ts'),
    ]) {
      expect(source).not.toMatch(
        /console\.(?:log|error|warn)[\s\S]{0,200}(?:WORKER_DATABASE_URL|capability)/u
      );
    }
  });
});
