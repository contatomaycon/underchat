import fs from 'node:fs';
import path from 'node:path';

describe('workerGrpcServer plugin', () => {
  it('acks worker commands only after the worker operation completes', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).not.toContain('void handler.handle(payload)');
    expect(source).toMatch(
      /handler\s*\.handle\(payload\)\s*\.then\(\(\) => \{[\s\S]*?callback\(null, \{\}\);/u
    );
    expect(source).toMatch(
      /\.catch\(\(err\) => \{\s*callback\(handleError\(err\), null\);/u
    );
  });

  it('copies reserved recreate server slot metadata into the worker payload', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).toContain('WORKER_RECREATE_SERVER_SLOT_KEY_METADATA');
    expect(source).toContain('payload.recreate_server_slot_key');
    expect(source).toContain('payload.recreate_server_slot_token');
  });

  it('maps exhausted recreate-slot holds to a lifecycle deadline for durable redrive', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).toContain('isWorkerRecreateServerSlotHoldTimeoutError');
    expect(source).toContain('status.DEADLINE_EXCEEDED');
    expect(source).toContain('workerLifecycleGrpcErrorCode(err)');
  });

  it('maps authoritative lifecycle fence and container conflicts to failed precondition', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).toContain(
      'isWorkerLifecycleAuthoritativeConflictError(error)'
    );
    expect(source).toContain('status.FAILED_PRECONDITION');
    expect(source).toContain('workerLifecycleGrpcErrorCode(err)');
  });

  it('rejects fenced worker commands without their journal fingerprint before handling', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );
    const handlerStart = source.indexOf('const handleUnary');
    const nextHandler = source.indexOf('\n  const handle', handlerStart + 1);
    const handlerSource = source.slice(handlerStart, nextHandler);

    expect(handlerSource).toContain('payload.lifecycle_operation_id');
    expect(handlerSource).toContain(
      '!payload.lifecycle_semantic_fingerprint?.trim()'
    );
    expect(handlerSource).toContain('status.INVALID_ARGUMENT');
    expect(
      handlerSource.indexOf('!payload.lifecycle_semantic_fingerprint?.trim()')
    ).toBeLessThan(handlerSource.indexOf('.handle(payload)'));
  });

  it('settles every journal-less destructive command before the handler can mutate runtime state', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );
    const handlerStart = source.indexOf('const handleUnary');
    const nextHandler = source.indexOf('\n  const handle', handlerStart + 1);
    const handlerSource = source.slice(handlerStart, nextHandler);

    for (const action of ['create', 'delete', 'recreate', 'cleanup']) {
      expect(handlerSource).toContain(`action === '${action}'`);
    }
    expect(handlerSource).toContain('!payload.lifecycle_operation_id?.trim()');
    expect(handlerSource).toContain('callback(null, {});');
    expect(handlerSource).toContain('return;');
    expect(handlerSource).toContain('destructive_lifecycle_identity_missing');
    expect(
      handlerSource.indexOf('!payload.lifecycle_operation_id?.trim()')
    ).toBeLessThan(handlerSource.indexOf('.handle(payload)'));
  });

  it('rejects warm activation without operation identity and journal fingerprint', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );
    const handlerStart = source.indexOf('const handleActivateWarmWorker');
    const nextHandler = source.indexOf('\n  const handle', handlerStart + 1);
    const handlerSource = source.slice(handlerStart, nextHandler);

    expect(handlerSource).toContain('!req.lifecycle_operation_id?.trim()');
    expect(handlerSource).toContain(
      '!req.lifecycle_semantic_fingerprint?.trim()'
    );
    expect(handlerSource).toContain('status.INVALID_ARGUMENT');
    expect(
      handlerSource.indexOf('!req.lifecycle_semantic_fingerprint?.trim()')
    ).toBeLessThan(handlerSource.indexOf('.activateWarmWorker(req)'));
  });

  it('rejects an unaccepted online status as a failed precondition', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).toContain('WorkerOnlineReadinessRejectedError');
    expect(source).toContain('status.FAILED_PRECONDITION');
  });

  it('authenticates durable runtime-fence activation before touching PostgreSQL', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).toContain('balanceRuntimeFenceToken()');
    expect(source).toContain('BALANCER_RUNTIME_FENCE_TOKEN_METADATA');
    expect(source).toContain('isValidBalancerRuntimeFenceToken');
    expect(source).toContain('status.UNAUTHENTICATED');
    expect(source.indexOf('isValidBalancerRuntimeFenceToken')).toBeLessThan(
      source.indexOf('.activateWhatsappRuntimeFence(call.request)')
    );
  });

  it('authenticates every warm-pool mutation before touching lifecycle state or Docker', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).toContain('hasValidWarmControlCredential');
    expect(source).toContain('rejectInvalidRuntimeFenceCredential');
    for (const handlerName of [
      'handleCreateWarmWorker',
      'handleDeleteWarmWorker',
      'handleActivateWarmWorker',
    ]) {
      const handlerStart = source.indexOf(`const ${handlerName}`);
      const nextHandler = source.indexOf('\n  const handle', handlerStart + 1);
      const handlerSource = source.slice(
        handlerStart,
        nextHandler === -1 ? undefined : nextHandler
      );
      expect(handlerSource).toContain(
        'hasValidWarmControlCredential(call.metadata)'
      );
      expect(
        handlerSource.indexOf('hasValidWarmControlCredential')
      ).toBeLessThan(handlerSource.indexOf('handler'));
    }
  });

  it('acknowledges warm creation admission before the long-running readiness operation settles', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );
    const handlerStart = source.indexOf('const handleCreateWarmWorker');
    const nextHandler = source.indexOf('\n  const handle', handlerStart + 1);
    const handlerSource = source.slice(handlerStart, nextHandler);
    const creationStart = handlerSource.indexOf(
      'creation = warmCreationQueue.enqueue('
    );
    const acknowledgement = handlerSource.indexOf('callback(null, {');
    const backgroundObservation = handlerSource.indexOf('void creation.catch');

    expect(creationStart).toBeGreaterThanOrEqual(0);
    expect(backgroundObservation).toBeGreaterThan(creationStart);
    expect(acknowledgement).toBeGreaterThan(backgroundObservation);
    expect(handlerSource).toContain('claimed: true');
    expect(handlerSource).toContain(
      'validateWarmMutationTarget(request, callback)'
    );
    expect(handlerSource).toContain(
      "'CreateWarmWorker background operation failed'"
    );
    expect(source).toContain('WARM_CREATION_MAX_PENDING');
    expect(source).toContain('operationTimeoutMs:');
    expect(source).toContain('requestWarmCreationProcessReplacement');
    expect(source).toContain(
      'warmCreationQueue.close(WARM_CREATION_SHUTDOWN_DRAIN_MS)'
    );
  });

  it('fences every warm mutation to this server and only three supported providers', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).toContain('EWorkerType.baileys');
    expect(source).toContain('EWorkerType.wwebjs');
    expect(source).toContain('EWorkerType.whatsmeow');
    expect(source).toContain(
      'request.server_id.trim() !== balanceEnvironment.serverId'
    );
    for (const handlerName of [
      'handleCreateWarmWorker',
      'handleDeleteWarmWorker',
      'handleActivateWarmWorker',
    ]) {
      const handlerStart = source.indexOf(`const ${handlerName}`);
      const nextHandler = source.indexOf('\n  const handle', handlerStart + 1);
      const handlerSource = source.slice(
        handlerStart,
        nextHandler === -1 ? undefined : nextHandler
      );
      expect(handlerSource).toContain('validateWarmMutationTarget(');
      expect(handlerSource.indexOf('validateWarmMutationTarget')).toBeLessThan(
        handlerSource.indexOf('handler')
      );
    }
  });

  it('authenticates Chromium lock cleanup before inspecting Docker or runtime ownership', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );
    const handlerStart = source.indexOf(
      'const handleAuthorizeChromiumLockCleanup'
    );
    const nextHandler = source.indexOf(
      '\n  grpcServer.addService',
      handlerStart
    );
    const handlerSource = source.slice(handlerStart, nextHandler);

    expect(handlerSource).toContain(
      'hasValidRuntimeFenceCredential(call.metadata)'
    );
    expect(handlerSource).toContain('rejectInvalidRuntimeFenceCredential');
    expect(
      handlerSource.indexOf('hasValidRuntimeFenceCredential')
    ).toBeLessThan(
      handlerSource.indexOf('.authorizeChromiumLockCleanup(call.request)')
    );
  });

  it('retries operational database failures but rejects stale runtime ownership', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'packages/plugins/proto/workerGrpcServer.ts'),
      'utf8'
    );

    expect(source).toContain('StaleWhatsappRuntimeDatabaseFenceError');
    expect(source).toContain('? status.FAILED_PRECONDITION');
    expect(source).toContain(': status.UNAVAILABLE');
  });
});
