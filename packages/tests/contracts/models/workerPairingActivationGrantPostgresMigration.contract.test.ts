import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260809143000.sql'),
  'utf8'
);
const resumablePairingMigration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260810130000.sql'),
  'utf8'
);
const grantModel = readFileSync(
  resolve(
    process.cwd(),
    'packages/models/worker/workerWhatsappPairingActivationGrant.model.ts'
  ),
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

function nineArgumentActivationFunction(): string {
  const marker =
    'CREATE OR REPLACE FUNCTION public.activate_whatsapp_runtime_fence(';
  const start = migration.indexOf(marker);
  if (start < 0) {
    throw new Error('pairing-grant activation function was not found');
  }
  const end = migration.indexOf('$function$;', start);
  if (end < 0) {
    throw new Error('pairing-grant activation function is not terminated');
  }
  const source = migration.slice(start, end + '$function$;'.length);
  if (!source.includes('p_connection_attempt_id uuid')) {
    throw new Error('the first activation function is not the 9-argument one');
  }
  return source;
}

function migrationFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.indexOf(marker);
  if (start < 0) {
    throw new Error(`migration function ${name} was not found`);
  }
  const end = migration.indexOf('$function$;', start);
  if (end < 0) {
    throw new Error(`migration function ${name} is not terminated`);
  }
  return migration.slice(start, end + '$function$;'.length);
}

describe('durable WhatsApp pairing activation grant PostgreSQL contract', () => {
  it('installs a one-shot, worker-owned grant with matching Drizzle constraints', () => {
    for (const fragment of [
      'connection_attempt_id uuid PRIMARY KEY',
      'FOREIGN KEY (account_id, worker_id)',
      'REFERENCES public.worker(account_id, worker_id)',
      'whatsapp_pairing_activation_grant_active_worker_uidx',
      'WHERE consumed_at IS NULL AND revoked_at IS NULL',
      'whatsapp_pairing_activation_grant_epoch_uidx',
      'whatsapp_pairing_activation_grant_worker_idx',
      'ON public.whatsapp_pairing_activation_grant(worker_id, account_id)',
      'whatsapp_pairing_activation_grant_epoch_transition_check',
      'CHECK (authorized_connection_epoch::text IS DISTINCT FROM',
      'created_at timestamptz NOT NULL DEFAULT clock_timestamp()',
      'CHECK (NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL))',
      'REVOKE ALL ON TABLE public.whatsapp_pairing_activation_grant FROM PUBLIC',
    ]) {
      expect(migration).toContain(fragment);
    }

    for (const constraint of [
      'whatsapp_pairing_activation_grant_worker_fk',
      'whatsapp_pairing_activation_grant_active_worker_uidx',
      'whatsapp_pairing_activation_grant_epoch_uidx',
      'whatsapp_pairing_activation_grant_worker_idx',
      'whatsapp_pairing_activation_grant_epoch_transition_check',
      'whatsapp_pairing_activation_grant_terminal_check',
    ]) {
      expect(grantModel).toContain(constraint);
    }
    expect(grantModel).toContain(
      'authorized_connection_epoch}::text IS DISTINCT FROM ${table.expected_connection_epoch}'
    );
    expect(grantModel).toContain('.default(sql`clock_timestamp()`)');
  });

  it('resolves only the fresh pending CAS, its stranded completion, or the consumed current owner', () => {
    const resolveFence = migrationFunction(
      'resolve_whatsapp_runtime_owned_connection_fence'
    );

    expect(resolveFence).toMatch(
      /pairing_grant\.consumed_at IS NULL[\s\S]+pairing_grant\.expires_at > statement_timestamp\(\)[\s\S]+pairing_grant\.expected_connection_epoch IS NOT DISTINCT FROM[\s\S]+runtime\.connection_sequence[\s\S]+pairing_grant\.connection_sequence_at_grant/u
    );
    expect(resolveFence).toMatch(
      /pairing_grant\.consumed_at IS NULL[\s\S]+pairing_grant\.authorized_connection_epoch::text =[\s\S]+runtime\.connection_epoch[\s\S]+runtime\.source_provider = pairing_grant\.provider[\s\S]+runtime\.connection_sequence =[\s\S]+pairing_grant\.connection_sequence_at_grant \+ 1/u
    );
    expect(resolveFence).toMatch(
      /pairing_grant\.consumed_at IS NOT NULL[\s\S]+pairing_grant\.authorized_connection_epoch::text =[\s\S]+runtime\.connection_epoch[\s\S]+runtime\.connection_sequence =[\s\S]+pairing_grant\.connection_sequence_at_grant \+ 1/u
    );
  });

  it('uses the global worker-runtime-session-lease-grant lock order', () => {
    const activate = nineArgumentActivationFunction();
    const workerLock = activate.indexOf('FROM public.worker AS owner');
    const runtimeLock = activate.indexOf(
      'FROM public.worker_runtime AS runtime'
    );
    const sessionLock = activate.indexOf(
      'FROM public.whatsapp_session AS session'
    );
    const leaseLock = activate.indexOf(
      'FROM public.whatsapp_session_lease AS lease'
    );
    const grantLock = activate.indexOf(
      'FROM public.whatsapp_pairing_activation_grant AS pairing_grant'
    );

    expect(workerLock).toBeGreaterThan(-1);
    expect(runtimeLock).toBeGreaterThan(workerLock);
    expect(sessionLock).toBeGreaterThan(runtimeLock);
    expect(leaseLock).toBeGreaterThan(sessionLock);
    expect(grantLock).toBeGreaterThan(leaseLock);
    expect(activate.slice(workerLock, runtimeLock)).toContain('FOR SHARE');
    expect(activate.slice(runtimeLock, sessionLock)).toContain('FOR UPDATE');
    expect(activate.slice(sessionLock, leaseLock)).toContain('FOR SHARE');
    expect(activate.slice(leaseLock, grantLock)).toContain('FOR UPDATE');
  });

  it('keeps the grant table private and exposes only fenced definer functions', () => {
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.whatsapp_pairing_activation_grant\n' +
        '  FROM whatsapp_session_runtime;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION\n' +
        '  public.resolve_whatsapp_runtime_owned_connection_fence('
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION\n' +
        '  public.activate_whatsapp_runtime_fence_pairing_grant_base('
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.activate_whatsapp_runtime_fence(\n' +
        '  uuid, uuid, text, integer, uuid, text, text, uuid, uuid\n' +
        ') FROM PUBLIC;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.activate_whatsapp_runtime_fence(\n' +
        '  uuid, uuid, text, integer, uuid, text, text, uuid, uuid\n' +
        ') TO whatsapp_session_runtime;'
    );
  });

  it('revalidates the complete empty session tree and retained lease at activation time', () => {
    const activate = nineArgumentActivationFunction();

    for (const field of [
      'session.active_revision_id IS NULL',
      'session.previous_revision_id IS NULL',
      'session.active_device_fingerprint IS NULL',
      'session.active_device_fingerprint_version IS NULL',
      'session.last_persisted_at IS NULL',
      'session.last_error_at IS NULL',
    ]) {
      expect(activate).toContain(field);
    }
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
      expect(activate).toContain(`FROM public.${table}`);
    }
    expect(activate).toContain('lease.generation = p_generation');
    expect(activate).toContain('lease.epoch = p_writer_epoch');
    expect(activate).toContain('v_lease_released OR v_lease_expired');
    expect(activate).toContain(
      'v_lease_released OR v_lease_expired OR v_lease_live'
    );
  });

  it('atomically consumes fresh grants and heals the exact post-update pending retry', () => {
    const activate = nineArgumentActivationFunction();

    expect(activate).toMatch(
      /v_active_grant_completion := COALESCE\(\([\s\S]+v_runtime\.connection_epoch = p_connection_epoch::text[\s\S]+v_runtime\.source_provider = lower\(trim\(p_provider\)\)[\s\S]+v_runtime\.connection_sequence = v_active_grant_sequence \+ 1/u
    );
    expect(activate).toMatch(
      /IF NOT v_active_grant_completion THEN[\s\S]+NOT v_session_found[\s\S]+NOT v_session_empty[\s\S]+NOT v_lease_found/u
    );
    expect(activate).toMatch(
      /UPDATE public\.whatsapp_pairing_activation_grant AS pairing_grant[\s\S]+SET consumed_at = clock_timestamp\(\)[\s\S]+pairing_grant\.connection_attempt_id = p_connection_attempt_id[\s\S]+pairing_grant\.expected_connection_epoch IS NOT DISTINCT FROM[\s\S]+pairing_grant\.connection_sequence_at_grant = v_active_grant_sequence[\s\S]+v_active_grant_completion[\s\S]+pairing_grant\.expires_at > clock_timestamp\(\)/u
    );
    expect(activate).toContain(
      "RAISE EXCEPTION 'whatsapp pairing activation grant changed'"
    );
    expect(activate).toContain("USING ERRCODE = '40001'");
  });

  it('keeps repository validation and direct activation behavior aligned', () => {
    for (const source of [
      migration,
      runtimeRepository,
      databaseFenceRepository,
    ]) {
      expect(source).not.toMatch(/\bAS grant\b/u);
    }
    expect(runtimeRepository).toMatch(
      /!UUID_PATTERN\.test\(workerId\)[\s\S]+!UUID_PATTERN\.test\(accountId\)/u
    );
    expect(runtimeRepository).toContain(
      'authorizedConnectionEpoch === expectedConnectionEpoch'
    );
    expect(runtimeRepository).toContain(
      'activation_grant.expires_at > clock_timestamp() AS grant_live'
    );
    expect(runtimeRepository).toMatch(
      /activation_grant\.consumed_at IS NULL[\s\S]+activation_grant\.authorized_connection_epoch::text =[\s\S]+runtime\.connection_epoch[\s\S]+activation_grant\.connection_sequence_at_grant \+ 1/u
    );
    expect(databaseFenceRepository).toContain(
      'inspectPairingSessionReadinessInTransaction'
    );
    expect(databaseFenceRepository).toContain('const pairingSessionReady =');
    expect(databaseFenceRepository).toContain(
      'await consumePendingGrantInTransaction('
    );
  });

  it('admits only the exact runtime-owned Baileys pairing draft at the direct worker boundary', () => {
    for (const fragment of [
      "session.state = 'preparing'",
      "session.provider = 'baileys'",
      'session.active_revision_id IS NOT NULL',
      'session.previous_revision_id IS NULL',
      "revision.status = 'staging'",
      "revision.source = 'pairing'",
      'revision.writer_generation = p_generation',
      'revision.writer_epoch = p_writer_epoch',
      "provider_record.namespace <> 'baileys/creds'",
      'device.jid IS NOT NULL',
      'v_grant_expected_epoch IS DISTINCT FROM v_runtime.connection_epoch',
      'v_grant_sequence IS DISTINCT FROM v_runtime.connection_sequence',
      'NOT v_disconnect_barrier_active AND v_lease_live',
    ]) {
      expect(resumablePairingMigration).toContain(fragment);
    }

    expect(resumablePairingMigration).toContain(
      'activate_whatsapp_runtime_fence_pairing_session_base'
    );
    expect(resumablePairingMigration).toContain(
      "v_worker_status_id = '019feb94-c2ff-76b1-9d00-d7602a50affe'::uuid"
    );
    expect(resumablePairingMigration).toMatch(
      /FROM public\.whatsapp_session AS session[\s\S]+FOR SHARE;[\s\S]+FROM public\.whatsapp_session_lease AS lease[\s\S]+FOR UPDATE;[\s\S]+FROM public\.whatsapp_pairing_activation_grant AS pairing_grant[\s\S]+FOR UPDATE;/u
    );
  });
});
