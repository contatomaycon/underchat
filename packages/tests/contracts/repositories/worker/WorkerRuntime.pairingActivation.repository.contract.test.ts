import 'reflect-metadata';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerRuntimeRepository } from '@core/repositories/worker/WorkerRuntime.repository';

const workerId = '00000000-0000-4000-8000-000000000001';
const accountId = '00000000-0000-4000-8000-000000000002';
const writerEpoch = '00000000-0000-4000-8000-000000000003';
const connectionEpoch = '00000000-0000-4000-8000-000000000004';
const authorizedEpoch = '00000000-0000-4000-8000-000000000005';
const attemptId = '00000000-0000-4000-8000-000000000006';
const leaseOwnerId = '00000000-0000-4000-8000-000000000007';
const containerId = 'a'.repeat(64);
const capabilityHash = 'b'.repeat(64);
const pairingReadyObservedAt = '2026-08-10T21:00:00.000Z';
type PairingProvider = 'baileys' | 'whatsmeow' | 'wwebjs';
const workerTypeByProvider: Record<PairingProvider, EWorkerType> = {
  baileys: EWorkerType.baileys,
  whatsmeow: EWorkerType.whatsmeow,
  wwebjs: EWorkerType.wwebjs,
};

function makeDatabase(
  input: {
    provider?: PairingProvider;
    providerRecords?: number;
    devices?: number;
    sessionState?: 'empty' | 'preparing' | 'ready';
    nonPairingProviderRecords?: number;
    workerContainerId?: string | null;
    workerStatusId?: EWorkerStatus;
    exactDisconnectBarrier?: boolean;
    workerNumber?: string | null;
    workerConnectionDate?: string | null;
  } = {}
) {
  const dialect = new PgDialect();
  const statements: string[] = [];
  const provider = input.provider ?? 'baileys';
  const allowsBaileysPlaceholders = provider === 'baileys';
  const sessionState = input.sessionState ?? 'preparing';
  const sessionIsEmpty = sessionState === 'empty';
  const execute = jest.fn(async (query: SQL) => {
    const statement = dialect.sqlToQuery(query).sql;
    statements.push(statement);

    if (statement.includes('FROM public.worker AS owner')) {
      return {
        rows: [
          {
            account_id: accountId,
            worker_type_id: workerTypeByProvider[provider],
            worker_status_id: input.workerStatusId ?? EWorkerStatus.disponible,
            lifecycle_operation_id: null,
            session_storage: EWorkerSessionStorage.postgres,
            container_id:
              input.workerContainerId === undefined
                ? containerId
                : input.workerContainerId,
            number: input.workerNumber ?? null,
            connection_date: input.workerConnectionDate ?? null,
            last_connection_check_at: null,
            deleted_at: null,
          },
        ],
      };
    }
    if (statement.includes('FROM public.worker_runtime AS runtime')) {
      return {
        rows: [
          {
            runtime_generation: 5,
            container_id: containerId,
            session_storage: EWorkerSessionStorage.postgres,
            source_provider: provider,
            runtime_capability_hash: capabilityHash,
            session_writer_epoch: writerEpoch,
            connection_epoch: connectionEpoch,
            disconnected_connection_epoch: input.exactDisconnectBarrier
              ? connectionEpoch
              : null,
            connection_disconnected_at: input.exactDisconnectBarrier
              ? '2026-08-10T21:30:00.000Z'
              : null,
            connection_sequence: 2,
            native_connection_status: null,
            native_connection_public_status: null,
            native_connection_online_acknowledged: false,
          },
        ],
      };
    }
    if (statement.includes('SELECT session.session_id')) {
      return { rows: [{ session_id: workerId }] };
    }
    if (statement.includes('FROM public.whatsapp_session_lease AS lease')) {
      return {
        rows: [
          {
            owner_id: leaseOwnerId,
            provider,
            fencing_token: 6,
            generation: 5,
            epoch: writerEpoch,
            expires_at: '2026-08-10T15:00:00.000Z',
            lease_released: false,
            lease_expired: false,
            lease_live: true,
          },
        ],
      };
    }
    if (statement.includes('SELECT session.state')) {
      return {
        rows: [
          {
            state: sessionState,
            provider,
            generation: 5,
            epoch: writerEpoch,
            capability_hash: capabilityHash,
            active_revision_id: sessionIsEmpty ? null : 2083,
            previous_revision_id: null,
            active_device_fingerprint: null,
            active_device_fingerprint_version: null,
            last_persisted_at: sessionIsEmpty
              ? null
              : '2026-08-09T19:45:01.752Z',
            last_error_at: null,
          },
        ],
      };
    }
    if (statement.includes('SELECT revision.revision_id')) {
      if (sessionIsEmpty) {
        return { rows: [] };
      }
      return {
        rows: [
          {
            revision_id: 2083,
            provider,
            status: 'staging',
            source: 'pairing',
            writer_generation: 5,
            writer_epoch: writerEpoch,
            capability_hash: capabilityHash,
            devices: input.devices ?? (allowsBaileysPlaceholders ? 1 : 0),
            identified_devices: 0,
            non_pairing_provider_records: input.nonPairingProviderRecords ?? 0,
          },
        ],
      };
    }
    if (statement.includes('AS revisions')) {
      return {
        rows: [
          {
            revisions: sessionIsEmpty ? 0 : 1,
            reservations: 0,
            handoffs: 0,
            gc_entries: sessionIsEmpty ? 0 : 1,
            provider_records:
              input.providerRecords ??
              (sessionIsEmpty ? 0 : allowsBaileysPlaceholders ? 1 : 0),
            devices:
              input.devices ??
              (sessionIsEmpty ? 0 : allowsBaileysPlaceholders ? 1 : 0),
            artifacts: 0,
            profile_anchors: 0,
            artifact_chunks: 0,
            artifact_blobs: 0,
          },
        ],
      };
    }
    if (statement.includes('UPDATE public.whatsapp_session AS session')) {
      return { rows: [], rowCount: 1 };
    }
    if (statement.includes('UPDATE public.worker AS owner')) {
      return {
        rows: [{ worker_status_observed_at: pairingReadyObservedAt }],
        rowCount: 1,
      };
    }
    if (statement.includes('DELETE FROM public.whatsapp_session_revision')) {
      return { rows: [], rowCount: 1 };
    }
    if (statement.includes('WHERE activation_grant.connection_attempt_id =')) {
      return { rows: [], rowCount: 0 };
    }
    if (statement.includes('SELECT activation_grant.connection_attempt_id')) {
      return { rows: [], rowCount: 0 };
    }
    if (
      statement.includes('INSERT INTO public.whatsapp_pairing_activation_grant')
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

function prepare(
  repository: WorkerRuntimeRepository,
  provider: PairingProvider = 'baileys',
  verifiedRunningContainerId?: string
) {
  return repository.prepareWorkerConnectionPairingActivation({
    worker_id: workerId,
    account_id: accountId,
    provider,
    expected_runtime_generation: 5,
    expected_container_id: containerId,
    expected_connection_epoch: connectionEpoch,
    connection_attempt_id: attemptId,
    authorized_connection_epoch: authorizedEpoch,
    verified_running_container_id: verifiedRunningContainerId,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
}

describe('WorkerRuntimeRepository pairing activation', () => {
  it('reuses the exact fenced Baileys pairing draft without mutating its live native store', async () => {
    const fake = makeDatabase();
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(prepare(repository)).resolves.toEqual({
      status: 'granted',
      already_granted: false,
      worker_status_id: EWorkerStatus.disponible,
      worker_status_observed_at: pairingReadyObservedAt,
    });

    const sessionLock = fake.statements.findIndex((statement) =>
      statement.includes('SELECT session.session_id')
    );
    const leaseLock = fake.statements.findIndex((statement) =>
      statement.includes('FROM public.whatsapp_session_lease AS lease')
    );
    const grantInsert = fake.statements.findIndex((statement) =>
      statement.includes('INSERT INTO public.whatsapp_pairing_activation_grant')
    );
    expect(sessionLock).toBeGreaterThan(-1);
    expect(sessionLock).toBeLessThan(leaseLock);
    expect(leaseLock).toBeLessThan(grantInsert);
    expect(
      fake.statements.some((statement) =>
        statement.includes('UPDATE public.whatsapp_session AS session')
      )
    ).toBe(false);
    expect(
      fake.statements.some((statement) =>
        statement.includes('DELETE FROM public.whatsapp_session_revision')
      )
    ).toBe(false);
  });

  it.each(['wwebjs', 'whatsmeow'] as const)(
    'reuses an empty fenced %s pairing draft without mutating its live native store',
    async (provider) => {
      const fake = makeDatabase({ provider });
      const repository = new WorkerRuntimeRepository(
        fake.database as never,
        fake.database as never
      );

      await expect(prepare(repository, provider)).resolves.toEqual({
        status: 'granted',
        already_granted: false,
        worker_status_id: EWorkerStatus.disponible,
        worker_status_observed_at: pairingReadyObservedAt,
      });
      expect(
        fake.statements.some((statement) =>
          statement.includes('UPDATE public.whatsapp_session AS session')
        )
      ).toBe(false);
      expect(
        fake.statements.some((statement) =>
          statement.includes('DELETE FROM public.whatsapp_session_revision')
        )
      ).toBe(false);
    }
  );

  it.each(['baileys', 'wwebjs', 'whatsmeow'] as const)(
    'starts a new %s pairing attempt on the exact live runtime after explicit logout',
    async (provider) => {
      const fake = makeDatabase({
        provider,
        sessionState: 'empty',
        exactDisconnectBarrier: true,
      });
      const repository = new WorkerRuntimeRepository(
        fake.database as never,
        fake.database as never
      );

      await expect(prepare(repository, provider)).resolves.toEqual({
        status: 'granted',
        already_granted: false,
        worker_status_id: EWorkerStatus.disponible,
        worker_status_observed_at: pairingReadyObservedAt,
      });
      expect(
        fake.statements.some((statement) =>
          statement.includes(
            'INSERT INTO public.whatsapp_pairing_activation_grant'
          )
        )
      ).toBe(true);
    }
  );

  it.each(['wwebjs', 'whatsmeow'] as const)(
    'rejects a %s pairing draft with provider state',
    async (provider) => {
      const fake = makeDatabase({ provider, providerRecords: 1 });
      const repository = new WorkerRuntimeRepository(
        fake.database as never,
        fake.database as never
      );

      await expect(prepare(repository, provider)).resolves.toEqual({
        status: 'session_not_empty',
      });
    }
  );

  it('rejects a pairing draft that contains non-pairing provider state', async () => {
    const fake = makeDatabase({ nonPairingProviderRecords: 1 });
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(prepare(repository)).resolves.toEqual({
      status: 'session_not_empty',
    });
    expect(
      fake.statements.some((statement) =>
        statement.includes(
          'INSERT INTO public.whatsapp_pairing_activation_grant'
        )
      )
    ).toBe(false);
  });

  it('does not reconcile a canonical ready session', async () => {
    const fake = makeDatabase({ sessionState: 'ready' });
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(prepare(repository)).resolves.toEqual({
      status: 'session_not_empty',
    });
    expect(
      fake.statements.some((statement) =>
        statement.includes('DELETE FROM public.whatsapp_session_revision')
      )
    ).toBe(false);
  });

  it('reattaches a physically verified runtime after an in-place remote logout', async () => {
    const fake = makeDatabase({
      workerContainerId: null,
      workerStatusId: EWorkerStatus.mismatched,
    });
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(prepare(repository, 'baileys', containerId)).resolves.toEqual({
      status: 'granted',
      already_granted: false,
      worker_status_id: EWorkerStatus.disponible,
      worker_status_observed_at: pairingReadyObservedAt,
    });
    const reattach = fake.statements.findIndex((statement) =>
      statement.includes('UPDATE public.worker AS owner')
    );
    const grantInsert = fake.statements.findIndex((statement) =>
      statement.includes('INSERT INTO public.whatsapp_pairing_activation_grant')
    );
    expect(reattach).toBeGreaterThan(-1);
    expect(reattach).toBeGreaterThan(grantInsert);
    expect(fake.statements[reattach]).toContain('SET worker_status_id =');
  });

  it('reattaches a physically verified available runtime after provisioning left the control pointer empty', async () => {
    const fake = makeDatabase({
      workerContainerId: null,
      workerStatusId: EWorkerStatus.disponible,
    });
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(prepare(repository, 'baileys', containerId)).resolves.toEqual({
      status: 'granted',
      already_granted: false,
      worker_status_id: EWorkerStatus.disponible,
      worker_status_observed_at: pairingReadyObservedAt,
    });
  });

  it.each(['baileys', 'wwebjs', 'whatsmeow'] as const)(
    'clears stale worker identity only after the canonical %s pairing draft is proven safe',
    async (provider) => {
      const fake = makeDatabase({
        provider,
        workerNumber: '556192037138',
        workerConnectionDate: '2026-08-10T20:54:00.000Z',
      });
      const repository = new WorkerRuntimeRepository(
        fake.database as never,
        fake.database as never
      );

      await expect(prepare(repository, provider)).resolves.toEqual({
        status: 'granted',
        already_granted: false,
        worker_status_id: EWorkerStatus.disponible,
        worker_status_observed_at: pairingReadyObservedAt,
      });
      const transition = fake.statements.find((statement) =>
        statement.includes('UPDATE public.worker AS owner')
      );
      expect(transition).toContain('number = NULL');
      expect(transition).toContain('connection_date = NULL');
    }
  );

  it('does not reattach a missing control pointer without a physical liveness proof', async () => {
    const fake = makeDatabase({
      workerContainerId: null,
      workerStatusId: EWorkerStatus.mismatched,
    });
    const repository = new WorkerRuntimeRepository(
      fake.database as never,
      fake.database as never
    );

    await expect(prepare(repository)).resolves.toEqual({
      status: 'terminal_state_invalid',
    });
    expect(
      fake.statements.some((statement) =>
        statement.includes('UPDATE public.worker AS owner')
      )
    ).toBe(false);
  });
});
