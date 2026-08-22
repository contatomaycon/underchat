import fs from 'node:fs';
import path from 'node:path';

describe('WorkerGrpcClientService', () => {
  it('uses a dedicated deadline that remains above the downstream connection deadline', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/services/workerGrpcClient.service.ts'),
      'utf8'
    );

    expect(source).toContain(
      'const WORKER_CONNECTION_STATUS_GRPC_DEADLINE_MS = Math.min('
    );
    expect(source).toContain(
      'DOWNSTREAM_REQUEST_CONNECTION_GRPC_DEADLINE_MS + 30_000'
    );
    expect(source).toContain(
      'process.env.WORKER_CONNECTION_STATUS_GRPC_DEADLINE_MS'
    );
    expect(source).toContain(
      'timeoutMs: number = WORKER_CONNECTION_STATUS_GRPC_DEADLINE_MS'
    );
    expect(source).toContain(
      'const deadline = new Date(Date.now() + timeoutMs);'
    );
    expect(source).toMatch(
      /\(client as any\)\.ChangeConnectionStatus\(\s*protoPayload,\s*metadata,\s*\{ deadline \},/u
    );
  });

  it('uses a bounded lifecycle deadline that covers the recreate slot wait', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/services/workerGrpcClient.service.ts'),
      'utf8'
    );

    expect(source).toContain('WORKER_LIFECYCLE_GRPC_DEADLINE_MS');
    expect(source).toContain('workerLifecycleBudgets.grpcDeadlineMs');
    expect(source).toContain(
      'timeoutMs: number = WORKER_LIFECYCLE_GRPC_DEADLINE_MS'
    );
    expect(source).toContain(
      "await this.call('RecreateWorker', payload, timeoutMs);"
    );
  });

  it('uses a bounded create dispatch by default', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/services/workerGrpcClient.service.ts'),
      'utf8'
    );

    expect(source).toContain(
      "await this.call('CreateWorker', payload, timeoutMs);"
    );
    expect(source).toContain(
      'timeoutMs: number = WORKER_LIFECYCLE_GRPC_DEADLINE_MS'
    );
  });

  it('uses an optional and bounded delete dispatch deadline by default', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/services/workerGrpcClient.service.ts'),
      'utf8'
    );

    expect(source).toContain('process.env.WORKER_DELETE_GRPC_DEADLINE_MS');
    expect(source).toMatch(
      /WORKER_DELETE_GRPC_DEADLINE_MS = positiveTimeout\([\s\S]*?5 \* 60_000[\s\S]*?\);/u
    );
    expect(source).toContain(
      'timeoutMs: number = WORKER_DELETE_GRPC_DEADLINE_MS'
    );
    expect(source).toContain(
      "await this.call('DeleteWorker', payload, timeoutMs);"
    );
  });

  it('propagates reserved recreate server slots through gRPC metadata', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/services/workerGrpcClient.service.ts'),
      'utf8'
    );

    expect(source).toContain('applyRecreateServerSlotMetadata');
    expect(source).toContain('WORKER_RECREATE_SERVER_SLOT_KEY_METADATA');
    expect(source).toContain('WORKER_RECREATE_SERVER_SLOT_TOKEN_METADATA');
  });

  it('authenticates warm-pool mutation calls with separate control-plane authority', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/services/workerGrpcClient.service.ts'),
      'utf8'
    );

    const callWarmStart = source.indexOf('private async callWarm(');
    const callWarmEnd = source.indexOf('\n  private ', callWarmStart + 1);
    const callWarmSource = source.slice(callWarmStart, callWarmEnd);

    expect(callWarmSource).toContain('BALANCE_WARM_CONTROL_TOKEN_METADATA');
    expect(callWarmSource).toContain('balanceWarmControlToken()');
    expect(callWarmSource.indexOf('metadata.set(')).toBeLessThan(
      callWarmSource.indexOf('(client as any)[method](')
    );
  });

  it('dispatches durable self-heal requests with control-plane authentication and a deadline', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/services/workerGrpcClient.service.ts'),
      'utf8'
    );
    const methodStart = source.indexOf('async requestWorkerSelfHealing(');
    const methodEnd = source.indexOf('\n  private async call(', methodStart);
    const methodSource = source.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThan(-1);
    expect(methodSource).toContain(
      'await this.workerGrpcRegistryService.getAddress(serverId)'
    );
    expect(methodSource).toContain('BALANCER_RUNTIME_FENCE_TOKEN_METADATA');
    expect(methodSource).toContain('balanceRuntimeFenceToken()');
    expect(methodSource).toContain(
      'const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);'
    );
    expect(methodSource).toMatch(
      /\.RequestWorkerSelfHealing\(\s*payload,\s*metadata,\s*\{ deadline \},/u
    );
    expect(methodSource.indexOf('metadata.set(')).toBeLessThan(
      methodSource.indexOf('.RequestWorkerSelfHealing(')
    );
  });
});
