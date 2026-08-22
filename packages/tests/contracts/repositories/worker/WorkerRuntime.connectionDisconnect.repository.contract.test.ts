import 'reflect-metadata';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { WorkerRuntimeRepository } from '@core/repositories/worker/WorkerRuntime.repository';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const workerId = '00000000-0000-4000-8000-000000000001';
const accountId = '00000000-0000-4000-8000-000000000002';
const containerId = 'a'.repeat(64);
const observedAt = '2026-08-09T14:15:16.123Z';
const writerEpoch = '00000000-0000-4000-8000-000000000003';
const capabilityHash = 'b'.repeat(64);

function makeDatabase(
  input: {
    alreadyFinalized?: boolean;
    barrierActive?: boolean;
    leaseState?: 'live' | 'expired' | 'released';
  } = {}
) {
  const barrierActive =
    input.alreadyFinalized === true || input.barrierActive !== false;
  const leaseState = input.leaseState ?? 'live';
  const dialect = new PgDialect();
  const statements: string[] = [];
  const execute = jest.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    const statement = compiled.sql;
    statements.push(statement);

    if (statement.includes('AS worker_status_observed_at')) {
      return { rows: [{ worker_status_observed_at: observedAt }] };
    }
    if (statement.includes('FROM public.worker AS owner')) {
      return {
        rows: [
          {
            account_id: accountId,
            lifecycle_operation_id: null,
            session_storage: EWorkerSessionStorage.postgres,
            container_id: containerId,
            worker_status_id: input.alreadyFinalized
              ? EWorkerStatus.disponible
              : EWorkerStatus.online,
            number: input.alreadyFinalized ? null : '5561999999999',
            connection_date: input.alreadyFinalized
              ? null
              : '2026-08-09T13:00:00.000Z',
            last_connection_check_at: input.alreadyFinalized
              ? null
              : '2026-08-09T13:30:00.000Z',
            deleted_at: null,
          },
        ],
      };
    }
    if (statement.includes('FROM public.worker_runtime AS runtime')) {
      return {
        rows: [
          {
            runtime_generation: 7,
            container_id: containerId,
            session_storage: EWorkerSessionStorage.postgres,
            source_provider: 'wwebjs',
            runtime_capability_hash: capabilityHash,
            session_writer_epoch: writerEpoch,
            connection_epoch: 'connection-epoch-1',
            disconnected_connection_epoch: barrierActive
              ? 'connection-epoch-1'
              : null,
            connection_disconnected_at: barrierActive ? observedAt : null,
            native_connection_status: input.alreadyFinalized
              ? null
              : { status: 'online' },
            native_connection_public_status: input.alreadyFinalized
              ? null
              : { status: 'online' },
            native_connection_status_source_id: null,
            native_connection_status_sequence: null,
            native_connection_status_outbox_id: null,
            native_connection_status_lease_owner_id: null,
            native_connection_status_fencing_token: null,
            native_connection_status_changed_at_high_watermark: null,
            native_connection_status_retired_source_ids: [],
            native_connection_online_acknowledged: false,
          },
        ],
      };
    }
    if (statement.includes('FROM public.whatsapp_session AS session')) {
      return {
        rows: [
          {
            state: 'empty',
            provider: 'wwebjs',
            generation: 7,
            epoch: writerEpoch,
            capability_hash: capabilityHash,
            active_revision_id: null,
            previous_revision_id: null,
            active_device_fingerprint: null,
            active_device_fingerprint_version: null,
            last_persisted_at: null,
            last_error_at: null,
          },
        ],
      };
    }
    if (statement.includes('FROM public.whatsapp_session_lease AS lease')) {
      return {
        rows: [
          {
            owner_id:
              leaseState === 'released'
                ? null
                : '00000000-0000-4000-8000-000000000004',
            provider: leaseState === 'released' ? null : 'wwebjs',
            fencing_token: 1,
            generation: 7,
            epoch: leaseState === 'released' ? null : writerEpoch,
            expires_at:
              leaseState === 'released' ? null : '2026-08-09T15:15:16.123Z',
            lease_live: leaseState === 'live',
            lease_released: leaseState === 'released',
            lease_expired: leaseState === 'expired',
          },
        ],
      };
    }
    if (statement.includes('AS revisions')) {
      return {
        rows: [
          {
            revisions: 0,
            reservations: 0,
            handoffs: 0,
            gc_entries: 0,
            provider_records: 0,
            artifacts: 0,
            profile_anchors: 0,
            artifact_chunks: 0,
            artifact_blobs: 0,
          },
        ],
      };
    }
    if (
      statement.includes('UPDATE public.worker_runtime') ||
      statement.includes('UPDATE public.worker\n')
    ) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const transaction = jest.fn(
    async (operation: (tx: { execute: typeof execute }) => Promise<unknown>) =>
      operation({ execute })
  );

  return { database: { transaction }, statements };
}

describe('WorkerRuntimeRepository finalizeWorkerConnectionDisconnect', () => {
  it('installs the connection-epoch barrier after draining the canonical session', async () => {
    const fake = makeDatabase({ barrierActive: false });
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(
      repository.prepareWorkerConnectionDisconnect({
        worker_id: workerId,
        account_id: accountId,
        expected_runtime_generation: 7,
        expected_container_id: containerId,
        expected_connection_epoch: 'connection-epoch-1',
      })
    ).resolves.toEqual({ status: 'prepared', already_prepared: false });

    const runtimeLock = fake.statements.findIndex((statement) =>
      statement.includes('FROM public.worker_runtime AS runtime')
    );
    const sessionLock = fake.statements.findIndex((statement) =>
      statement.includes('FROM public.whatsapp_session AS session')
    );
    const barrierUpdate = fake.statements.findIndex((statement) =>
      statement.includes('SET disconnected_connection_epoch')
    );
    expect(runtimeLock).toBeGreaterThan(-1);
    expect(runtimeLock).toBeLessThan(sessionLock);
    expect(sessionLock).toBeLessThan(barrierUpdate);
  });

  it('commits an empty, available projection without replacing the runtime', async () => {
    const fake = makeDatabase();
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(
      repository.finalizeWorkerConnectionDisconnect({
        worker_id: workerId,
        account_id: accountId,
        expected_runtime_generation: 7,
        expected_container_id: containerId,
        expected_connection_epoch: 'connection-epoch-1',
      })
    ).resolves.toEqual({
      status: 'completed',
      worker_id: workerId,
      worker_status_id: EWorkerStatus.disponible,
      runtime_generation: 7,
      container_id: containerId,
      worker_status_observed_at: observedAt,
    });

    const runtimeUpdate = fake.statements.find((statement) =>
      statement.includes('UPDATE public.worker_runtime')
    );
    const workerUpdate = fake.statements.find((statement) =>
      statement.includes('UPDATE public.worker\n')
    );
    expect(runtimeUpdate).toContain(
      'disconnected_connection_epoch = connection_epoch'
    );
    expect(runtimeUpdate).toContain('connection_disconnected_at = COALESCE');
    expect(runtimeUpdate).toContain('native_connection_status = NULL');
    expect(workerUpdate).toContain('last_connection_check_at = NULL');
    expect(workerUpdate).toContain(
      'external_connection_revision = external_connection_revision + 1'
    );
    expect(workerUpdate).toContain('container_id = $');
  });

  it('revalidates an already-finalized retry without incrementing revision again', async () => {
    const fake = makeDatabase({ alreadyFinalized: true });
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(
      repository.finalizeWorkerConnectionDisconnect({
        worker_id: workerId,
        account_id: accountId,
        expected_runtime_generation: 7,
        expected_container_id: containerId,
        expected_connection_epoch: 'connection-epoch-1',
      })
    ).resolves.toMatchObject({
      status: 'completed',
      worker_status_observed_at: observedAt,
    });

    expect(
      fake.statements.some((statement) =>
        statement.includes(
          'external_connection_revision = external_connection_revision + 1'
        )
      )
    ).toBe(false);
    expect(
      fake.statements.some((statement) =>
        statement.includes('UPDATE public.worker_runtime')
      )
    ).toBe(false);
  });

  it('recovers an expired exact lease only under the durable disconnect barrier', async () => {
    const fake = makeDatabase({ leaseState: 'expired' });
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(
      repository.finalizeWorkerConnectionDisconnect({
        worker_id: workerId,
        account_id: accountId,
        expected_runtime_generation: 7,
        expected_container_id: containerId,
        expected_connection_epoch: 'connection-epoch-1',
      })
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('recovers an exactly released lease under the durable disconnect barrier', async () => {
    const fake = makeDatabase({ leaseState: 'released' });
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(
      repository.finalizeWorkerConnectionDisconnect({
        worker_id: workerId,
        account_id: accountId,
        expected_runtime_generation: 7,
        expected_container_id: containerId,
        expected_connection_epoch: 'connection-epoch-1',
      })
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('fails closed for an expired lease without the exact disconnect barrier', async () => {
    const fake = makeDatabase({
      barrierActive: false,
      leaseState: 'expired',
    });
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(
      repository.finalizeWorkerConnectionDisconnect({
        worker_id: workerId,
        account_id: accountId,
        expected_runtime_generation: 7,
        expected_container_id: containerId,
        expected_connection_epoch: 'connection-epoch-1',
      })
    ).resolves.toEqual({ status: 'session_fence_invalid' });
  });
});
