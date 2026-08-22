import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260809130000.sql'),
  'utf8'
);
const runtimeRepository = readFileSync(
  resolve(
    process.cwd(),
    'packages/repositories/worker/WorkerRuntime.repository.ts'
  ),
  'utf8'
);
const databaseFenceRepository = readFileSync(
  resolve(
    process.cwd(),
    'packages/repositories/worker/WhatsappRuntimeDatabaseFence.repository.ts'
  ),
  'utf8'
);
const commandHandler = readFileSync(
  resolve(process.cwd(), 'packages/services/workerCommandHandler.service.ts'),
  'utf8'
);
const disconnectUseCase = readFileSync(
  resolve(
    process.cwd(),
    'packages/useCases/worker/WorkerConnectionDisconnecter.useCase.ts'
  ),
  'utf8'
);
const workerRoute = readFileSync(
  resolve(process.cwd(), 'apps/manager_api/src/routes/worker.route.ts'),
  'utf8'
);
const disconnectSchema = readFileSync(
  resolve(
    process.cwd(),
    'packages/schema/worker/disconnectWorkerConnection/response.schema.ts'
  ),
  'utf8'
);

function migrationFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.lastIndexOf(marker);
  if (start < 0) {
    throw new Error(`migration function ${name} was not found`);
  }
  const end = migration.indexOf('$function$;', start);
  if (end < 0) {
    throw new Error(`migration function ${name} is not terminated`);
  }
  return migration.slice(start, end + '$function$;'.length);
}

describe('in-place worker connection disconnect PostgreSQL contract', () => {
  it('clears every operational authentication root without deleting durable fencing/audit anchors', () => {
    const clearSession = migrationFunction('clear_whatsapp_session');

    for (const field of [
      'active_revision_id = NULL',
      'previous_revision_id = NULL',
      'active_device_fingerprint = NULL',
      'active_device_fingerprint_version = NULL',
      'last_persisted_at = NULL',
      'last_error_at = NULL',
    ]) {
      expect(clearSession).toContain(field);
    }
    for (const table of [
      'whatsapp_companion_reservation',
      'whatsapp_session_handoff',
      'whatsapp_artifact_chunk',
      'whatsapp_session_revision',
      'whatsapp_artifact_blob',
    ]) {
      expect(clearSession).toContain(`DELETE FROM public.${table}`);
    }
    expect(clearSession.indexOf('whatsapp_artifact_chunk')).toBeLessThan(
      clearSession.indexOf('whatsapp_artifact_blob')
    );
    expect(clearSession).not.toContain('DELETE FROM public.whatsapp_session\n');
    expect(clearSession).not.toContain(
      'DELETE FROM public.whatsapp_session_lease'
    );
    expect(clearSession).not.toContain(
      'DELETE FROM public.whatsapp_session_handoff_resolution'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.clear_whatsapp_session(\n' +
        '  uuid, uuid, bigint, integer, uuid, text\n' +
        ') TO whatsapp_session_runtime;'
    );
    expect(migration).not.toContain('underchat_worker_session');
  });

  it('installs a null-safe tombstone and makes delayed terminal status an idempotent no-op', () => {
    const applyStatus = migrationFunction('apply_worker_runtime_status');

    expect(migration).toContain('connection_disconnected_at timestamptz');
    expect(applyStatus).toContain(
      'runtime.connection_epoch IS NOT DISTINCT FROM\n          runtime.disconnected_connection_epoch'
    );
    expect(applyStatus).toContain("THEN 'duplicate'");
    expect(applyStatus).toContain("ELSE 'stale'");
    expect(applyStatus.indexOf('RETURN NEXT')).toBeLessThan(
      applyStatus.indexOf('public.apply_worker_runtime_status_disconnect_base(')
    );
    expect(databaseFenceRepository).toContain(
      '(runtimeRows[0].connection_disconnected_at ?? null) !== null'
    );
    expect(databaseFenceRepository).toContain(
      '(runtimeRows[0].disconnected_connection_epoch ?? null) ==='
    );
  });

  it('releases the barrier only through a different, successfully activated epoch', () => {
    const activate = migrationFunction('activate_whatsapp_runtime_fence');

    expect(activate).toContain(
      'v_disconnected_connection_epoch = p_connection_epoch::text'
    );
    expect(activate).toContain(
      'public.activate_whatsapp_runtime_fence_disconnect_base('
    );
    expect(activate).toMatch(
      /IF FOUND AND v_disconnect_barrier_active THEN[\s\S]+disconnected_connection_epoch = NULL,[\s\S]+connection_disconnected_at = NULL,[\s\S]+public\.activate_whatsapp_runtime_fence_disconnect_base/u
    );
    expect(activate).toMatch(
      /IF activated THEN[\s\S]+disconnected_connection_epoch = NULL,[\s\S]+connection_disconnected_at = NULL/u
    );
    expect(activate).toMatch(
      /ELSIF v_disconnect_barrier_active THEN[\s\S]+disconnected_connection_epoch = v_disconnected_connection_epoch,[\s\S]+connection_disconnected_at = v_connection_disconnected_at/u
    );
  });

  it('blocks a stale session writer from recreating the canonical operational tree', () => {
    const guard = migrationFunction(
      'guard_disconnected_whatsapp_session_writer'
    );

    expect(guard).toContain('connection_disconnected_at IS NOT NULL');
    expect(guard).toContain('IS NOT DISTINCT FROM');
    expect(guard).toMatch(
      /IF TG_TABLE_NAME = 'whatsapp_session' AND TG_OP = 'UPDATE' THEN\s+IF[\s\S]+NEW\.generation IS NOT DISTINCT FROM OLD\.generation/u
    );
    for (const trigger of [
      'whatsapp_session_revision_disconnect_guard',
      'whatsapp_companion_reservation_disconnect_guard',
      'whatsapp_session_handoff_disconnect_guard',
      'whatsapp_artifact_blob_disconnect_guard',
      'whatsapp_session_header_disconnect_guard',
    ]) {
      expect(migration).toContain(`CREATE TRIGGER ${trigger}`);
    }
    expect(migration).toContain(
      'BEFORE INSERT OR UPDATE ON public.whatsapp_session'
    );
  });

  it('proves an empty operational tree and preserves the in-place runtime/container projection', () => {
    for (const table of [
      'whatsapp_session_revision',
      'whatsapp_companion_reservation',
      'whatsapp_session_handoff',
      'whatsapp_session_gc_queue',
      'whatsapp_provider_record',
      'whatsapp_artifact',
      'whatsapp_wwebjs_profile_anchor',
      'whatsapp_artifact_chunk',
      'whatsapp_artifact_blob',
    ]) {
      expect(runtimeRepository).toContain(
        `SELECT count(*) FROM public.${table}`
      );
    }
    expect(runtimeRepository).toContain(
      'SET disconnected_connection_epoch = connection_epoch,'
    );
    expect(runtimeRepository).toContain(
      'connection_disconnected_at = clock_timestamp()'
    );
    expect(runtimeRepository).toContain('last_connection_check_at = NULL');
    expect(runtimeRepository).toContain(
      'container_id = ${expectedContainerId}'
    );
    expect(runtimeRepository).toContain(
      'external_connection_revision = external_connection_revision + 1'
    );
    expect(runtimeRepository).toContain('const alreadyFinalized =');
    expect(runtimeRepository).toContain('AS lease_live');
    expect(runtimeRepository).toContain('AS lease_released');
    expect(runtimeRepository).toContain('AS lease_expired');
    expect(runtimeRepository).toContain('const exactDisconnectBarrier =');
    expect(runtimeRepository).toContain('const canonicalSessionFenceMatches =');
    expect(runtimeRepository).toContain('const retainedLeaseFence =');
    expect(runtimeRepository).toContain(
      'sessionRow?.provider === runtimeRow.source_provider'
    );
    expect(runtimeRepository).toMatch(
      /leaseRow\?\.lease_live === true \|\|\s+leaseRow\?\.lease_expired === true/u
    );
    expect(runtimeRepository).toContain('leaseRow?.lease_released === true');
    expect(runtimeRepository).toContain('const retainedPostgresFence =');
    expect(runtimeRepository).toMatch(
      /const retainedPostgresFence =\s+exactDisconnectBarrier &&/u
    );
  });

  it('runs both strict QR invalidations and terminalization under the service lifecycle lock', () => {
    const start = commandHandler.indexOf('const removesSessionInPlace =');
    const end = commandHandler.indexOf(
      'async handleRequestConnectionQrCode(',
      start
    );
    const flow = commandHandler.slice(start, end);
    const firstInvalidation = flow.indexOf(
      'await this.invalidateQrAttemptState'
    );
    const prepareBarrier = flow.indexOf('prepareWorkerConnectionDisconnect');
    const providerClear = flow.indexOf(
      'await this.workerBaileysGrpcClientService.requestConnection'
    );
    const secondInvalidation = flow.indexOf(
      'worker_connection_disconnected_terminal'
    );
    const finalizer = flow.indexOf(
      'finalizeWorkerConnectionDisconnect',
      secondInvalidation
    );

    expect(flow).toContain('await this.runWithWorkerLifecycleLock(');
    expect(flow.match(/strict: true/g)).toHaveLength(2);
    expect(prepareBarrier).toBeGreaterThan(-1);
    expect(prepareBarrier).toBeLessThan(firstInvalidation);
    expect(firstInvalidation).toBeGreaterThan(-1);
    expect(firstInvalidation).toBeLessThan(providerClear);
    expect(providerClear).toBeLessThan(secondInvalidation);
    expect(secondInvalidation).toBeLessThan(finalizer);
    expect(flow).toContain('providerRequestFailed = true');
    expect(flow).toContain(
      'service.command_handler.disconnect_provider_error_recovered'
    );
  });

  it('treats realtime publication as best effort after the authoritative terminal commit', () => {
    expect(disconnectUseCase).toContain('await Promise.allSettled([');
    expect(disconnectUseCase).not.toMatch(
      /finalizeWorkerConnectionDisconnect[\s\S]+manager_disconnect_terminal[\s\S]+invalidateQrState/u
    );
  });

  it('keeps disconnect separate from the explicit recreate/reset contract', () => {
    expect(workerRoute).toContain(
      "server.delete('/worker/:worker_id/connection', {"
    );
    expect(workerRoute).toContain(
      "server.post('/worker/:worker_id/connection/reset', {"
    );
    for (const field of [
      'worker_status_id: Type.Literal(EWorkerStatus.disponible)',
      'session_removed: Type.Literal(true)',
      'disconnected_user: Type.Literal(true)',
      'runtime_generation: Type.Integer({ minimum: 1 })',
      'worker_status_observed_at: Type.String',
    ]) {
      expect(disconnectSchema).toContain(field);
    }
  });
});
