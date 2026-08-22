import 'reflect-metadata';

import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { WorkerRuntimeDatabaseService } from '@core/services/workerRuntimeDatabase.service';
import { getWorkerPostgresPool } from '@core/services/workerPostgresPool';

jest.mock('@core/services/workerPostgresPool', () => ({
  getWorkerPostgresPool: jest.fn(),
}));

const workerId = '01900000-0000-7000-8000-000000000211';
const accountId = '01900000-0000-7000-8000-000000000212';
const writerEpoch = '01900000-0000-7000-8000-000000000213';
const connectionEpoch = '01900000-0000-7000-8000-000000000214';
const connectionAttemptId = '01900000-0000-7000-8000-000000000219';

describe('WorkerRuntimeDatabaseService status/outbox fencing', () => {
  const query = jest.fn();

  beforeEach(() => {
    process.env.WORKER_ID = workerId;
    process.env.ACCOUNT_ID = accountId;
    process.env.WORKER_TYPE_ID = EWorkerType.wwebjs;
    process.env.RUNTIME_GENERATION = '9';
    process.env.WORKER_RUNTIME_CAPABILITY = 'b'.repeat(64);
    process.env.WORKER_WRITER_EPOCH = writerEpoch;
    process.env.HOSTNAME = '0123456789ab';
    query.mockReset();
    jest.mocked(getWorkerPostgresPool).mockReturnValue({ query } as never);
  });

  it('binds the local Docker identity to runtime-fence activation', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          activated: true,
          already_active: false,
          connection_sequence: '1',
        },
      ],
    });

    await new WorkerRuntimeDatabaseService().activateWhatsappRuntimeFence({
      worker_id: workerId,
      account_id: accountId,
      source_provider: 'wwebjs',
      connection_epoch: connectionEpoch,
    });

    const sql = String(query.mock.calls[0]?.[0]);
    const parameters = query.mock.calls[0]?.[1] as unknown[];
    expect(sql).toContain('$7, $8::uuid');
    expect(parameters).toEqual([
      workerId,
      accountId,
      'wwebjs',
      9,
      writerEpoch,
      'b'.repeat(64),
      '0123456789ab',
      connectionEpoch,
    ]);
  });

  it('passes the manager-owned attempt together with its authorized connection epoch', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          activated: true,
          already_active: false,
          connection_sequence: '8',
        },
      ],
    });

    await expect(
      new WorkerRuntimeDatabaseService().activateWhatsappRuntimeFence({
        worker_id: workerId,
        account_id: accountId,
        source_provider: 'wwebjs',
        connection_epoch: connectionEpoch,
        connection_attempt_id: connectionAttemptId,
      })
    ).resolves.toEqual({
      connection_sequence: 8,
      already_active: false,
    });

    const sql = String(query.mock.calls[0]?.[0]);
    const parameters = query.mock.calls[0]?.[1] as unknown[];
    expect(sql).toContain('$8::uuid, $9::uuid');
    expect(parameters).toEqual([
      workerId,
      accountId,
      'wwebjs',
      9,
      writerEpoch,
      'b'.repeat(64),
      '0123456789ab',
      connectionEpoch,
      connectionAttemptId,
    ]);
  });

  it('accepts a pending pairing grant with sequence zero so it can be pre-activated', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          connection_epoch: connectionEpoch,
          connection_attempt_id: connectionAttemptId,
          connection_sequence: '0',
          authorization_state: 'pending',
        },
      ],
    });

    await expect(
      new WorkerRuntimeDatabaseService().resolveWhatsappRuntimeOwnedConnectionFence(
        {
          worker_id: workerId,
          account_id: accountId,
          source_provider: 'wwebjs',
          runtime_generation: 9,
        }
      )
    ).resolves.toEqual({
      connection_epoch: connectionEpoch,
      connection_attempt_id: connectionAttemptId,
      connection_sequence: 0,
      authorization_state: 'pending',
    });

    expect(String(query.mock.calls[0]?.[0])).toContain(
      'resolve_whatsapp_runtime_owned_connection_fence'
    );
  });

  it('accepts an owned epoch only after it has a positive durable sequence', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          connection_epoch: connectionEpoch,
          connection_attempt_id: connectionAttemptId,
          connection_sequence: '8',
          authorization_state: 'owned',
        },
      ],
    });

    await expect(
      new WorkerRuntimeDatabaseService().resolveWhatsappRuntimeOwnedConnectionFence(
        {
          worker_id: workerId,
          account_id: accountId,
          source_provider: 'wwebjs',
          runtime_generation: 9,
        }
      )
    ).resolves.toEqual({
      connection_epoch: connectionEpoch,
      connection_attempt_id: connectionAttemptId,
      connection_sequence: 8,
      authorization_state: 'owned',
    });
  });

  it('fails closed when an owned epoch has not been durably activated', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          connection_epoch: connectionEpoch,
          connection_attempt_id: connectionAttemptId,
          connection_sequence: '0',
          authorization_state: 'owned',
        },
      ],
    });

    await expect(
      new WorkerRuntimeDatabaseService().resolveWhatsappRuntimeOwnedConnectionFence(
        {
          worker_id: workerId,
          account_id: accountId,
          source_provider: 'wwebjs',
          runtime_generation: 9,
        }
      )
    ).rejects.toThrow('worker_runtime_owned_connection_fence_invalid');
  });

  it('canonicalizes provider/runtime identity and keeps the connection fence', async () => {
    query.mockResolvedValueOnce({ rows: [{ outcome: 'applied' }] });

    await new WorkerRuntimeDatabaseService().notifyWorkerStatus({
      worker_id: workerId,
      account_id: accountId,
      status: EBaileysConnectionStatus.connected,
      code: ECodeMessage.connectionEstablished,
      worker_status_id: EWorkerStatus.online,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      connection_epoch: connectionEpoch,
      connection_sequence: 3,
      recreate_phase: EWorkerRecreatePhase.connecting,
      recreate_phase_observed_at: '2099-08-08T00:00:00.000Z',
      recreate_runtime_retired: true,
    });

    const parameters = query.mock.calls[0]?.[1] as unknown[];
    expect(parameters[2]).toBe('wwebjs');
    expect(parameters[3]).toBe(9);
    expect(parameters[4]).toBe(writerEpoch);
    expect(parameters[6]).toBe('0123456789ab');
    expect(JSON.parse(String(parameters[7]))).toEqual(
      expect.objectContaining({
        event_type: 'status',
        worker_type_id: EWorkerType.wwebjs,
        runtime_generation: 9,
        container_id: '0123456789ab',
        connection_epoch: connectionEpoch,
        connection_sequence: 3,
      })
    );
    expect(JSON.parse(String(parameters[7]))).not.toHaveProperty(
      'recreate_phase'
    );
    expect(JSON.parse(String(parameters[7]))).not.toHaveProperty(
      'recreate_phase_observed_at'
    );
    expect(JSON.parse(String(parameters[7]))).not.toHaveProperty(
      'recreate_runtime_retired'
    );
  });

  it('persists UI-only connection progress as telemetry without a status mutation', async () => {
    query.mockResolvedValueOnce({ rows: [{ outcome: 'applied' }] });

    await new WorkerRuntimeDatabaseService().publishWorkerRuntimeEvent({
      worker_id: workerId,
      account_id: accountId,
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitConnection,
      attempt: 2,
    });

    const parameters = query.mock.calls[0]?.[1] as unknown[];
    const payload = JSON.parse(String(parameters[7]));
    expect(payload.event_type).toBe('telemetry');
    expect(payload.worker_status_id).toBeUndefined();
    expect(payload.worker_type_id).toBe(EWorkerType.wwebjs);
    expect(payload.connection_status_lease_owner_id).toBeUndefined();
    expect(payload.connection_status_fencing_token).toBeUndefined();
  });

  it('materializes each attempt credential as telemetry even when its native status is unchanged', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ outcome: 'duplicate' }] })
      .mockResolvedValueOnce({ rows: [{ outcome: 'applied' }] });
    const changedAt = '2026-08-10T20:00:00.000Z';
    const sourceId = '01900000-0000-7000-8000-000000000220';

    await new WorkerRuntimeDatabaseService().notifyWorkerStatus({
      worker_id: workerId,
      account_id: accountId,
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: connectionAttemptId,
      connection_epoch: connectionEpoch,
      connection_sequence: 3,
      connection_status_source_id: sourceId,
      connection_status: {
        provider: 'wwebjs',
        status: EWhatsappConnectionStatus.qr,
        connected: false,
        authenticated: false,
        sessionValid: false,
        recoverable: true,
        qrAvailable: true,
        sequence: 7,
        changedAt,
      },
      qrcode: 'data:image/png;base64,new-rotated-qr',
      qr_generated_at: changedAt,
      attempt: 2,
      max_attempts: 5,
    });

    expect(query).toHaveBeenCalledTimes(2);
    const statusParameters = query.mock.calls[0]?.[1] as unknown[];
    const telemetryParameters = query.mock.calls[1]?.[1] as unknown[];
    const statusPayload = JSON.parse(String(statusParameters[7]));
    const telemetryPayload = JSON.parse(String(telemetryParameters[7]));
    expect(statusPayload).toEqual(
      expect.objectContaining({
        event_type: 'status',
        worker_status_id: EWorkerStatus.disponible,
        connection_status_source_id: sourceId,
        qrcode: 'data:image/png;base64,new-rotated-qr',
      })
    );
    expect(telemetryPayload).toEqual(
      expect.objectContaining({
        event_type: 'telemetry',
        connection_attempt_id: connectionAttemptId,
        qrcode: 'data:image/png;base64,new-rotated-qr',
        attempt: 2,
        max_attempts: 5,
      })
    );
    expect(telemetryPayload.worker_status_id).toBeUndefined();
    expect(telemetryPayload.connection_status).toBeUndefined();
    expect(telemetryPayload.connection_status_source_id).toBeUndefined();
    expect(telemetryParameters[8]).not.toBe(statusParameters[8]);
  });

  it('materializes QR exhaustion as attempt telemetry even when the durable status is unchanged', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ outcome: 'duplicate' }] })
      .mockResolvedValueOnce({ rows: [{ outcome: 'applied' }] });

    await new WorkerRuntimeDatabaseService().notifyWorkerStatus({
      worker_id: workerId,
      account_id: accountId,
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionClosed,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: connectionAttemptId,
      connection_epoch: connectionEpoch,
      connection_sequence: 3,
      attempt: 6,
      max_attempts: 5,
    });

    expect(query).toHaveBeenCalledTimes(2);
    const statusParameters = query.mock.calls[0]?.[1] as unknown[];
    const telemetryParameters = query.mock.calls[1]?.[1] as unknown[];
    const statusPayload = JSON.parse(String(statusParameters[7]));
    const telemetryPayload = JSON.parse(String(telemetryParameters[7]));

    expect(statusPayload).toEqual(
      expect.objectContaining({
        event_type: 'status',
        worker_status_id: EWorkerStatus.disponible,
        connection_attempt_id: connectionAttemptId,
        attempt: 6,
        max_attempts: 5,
      })
    );
    expect(telemetryPayload).toEqual(
      expect.objectContaining({
        event_type: 'telemetry',
        status: EBaileysConnectionStatus.disconnected,
        code: ECodeMessage.connectionClosed,
        connection_attempt_id: connectionAttemptId,
        attempt: 6,
        max_attempts: 5,
      })
    );
    expect(telemetryPayload.worker_status_id).toBeUndefined();
    expect(telemetryPayload.connection_status).toBeUndefined();
    expect(telemetryPayload.connection_status_source_id).toBeUndefined();
    expect(telemetryParameters[8]).not.toBe(statusParameters[8]);
  });

  it('adds the exact lease proof only to the private SQL envelope and reuses the supplied event ID', async () => {
    query.mockResolvedValueOnce({ rows: [{ outcome: 'applied' }] });
    const eventId = '01900000-0000-7000-8000-000000000217';
    const ownerId = '01900000-0000-7000-8000-000000000218';
    const input = {
      worker_id: workerId,
      account_id: accountId,
      status: EBaileysConnectionStatus.connected,
      code: ECodeMessage.connectionEstablished,
      worker_status_id: EWorkerStatus.online,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      connection_epoch: connectionEpoch,
      connection_sequence: 3,
    };

    await new WorkerRuntimeDatabaseService().notifyWorkerStatus(input, {
      eventId,
      connectionStatusLeaseProof: {
        ownerId,
        fencingToken: '42',
      },
    });

    const parameters = query.mock.calls[0]?.[1] as unknown[];
    expect(parameters[8]).toBe(eventId);
    expect(JSON.parse(String(parameters[7]))).toEqual(
      expect.objectContaining({
        connection_status_lease_owner_id: ownerId,
        connection_status_fencing_token: '42',
      })
    );
    expect(input).not.toHaveProperty('connection_status_lease_owner_id');
    expect(input).not.toHaveProperty('connection_status_fencing_token');
  });

  it.each(['stale', 'invalid'])(
    'rejects terminal SQL outcome %s',
    async (outcome) => {
      query.mockResolvedValueOnce({ rows: [{ outcome }] });

      await expect(
        new WorkerRuntimeDatabaseService().notifyWorkerStatus({
          worker_id: workerId,
          account_id: accountId,
          status: EBaileysConnectionStatus.connected,
          code: ECodeMessage.connectionEstablished,
          worker_status_id: EWorkerStatus.online,
          session_ready: true,
          can_send: true,
          can_receive_runtime: true,
          authenticated: true,
          connection_epoch: connectionEpoch,
          connection_sequence: 3,
        })
      ).rejects.toThrow(`worker_runtime_status_rejected:${outcome}`);
    }
  );

  it('accepts a durable or deduplicated self-healing request id', async () => {
    const requestId = '01900000-0000-7000-8000-000000000215';
    query.mockResolvedValueOnce({ rows: [{ request_id: requestId }] });

    await expect(
      new WorkerRuntimeDatabaseService().requestWorkerSelfHealing({
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.wwebjs,
        reason: 'runtime_degraded',
      })
    ).resolves.toBeUndefined();

    expect(String(query.mock.calls[0]?.[0])).toContain(
      'request_worker_self_heal'
    );
  });

  it('rejects a self-healing request refused by the runtime fence', async () => {
    query.mockResolvedValueOnce({
      rows: [{ request_id: null, created: false }],
    });

    await expect(
      new WorkerRuntimeDatabaseService().requestWorkerSelfHealing({
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: EWorkerType.wwebjs,
        reason: 'runtime_degraded',
      })
    ).rejects.toThrow('worker_self_heal_request_rejected');
  });

  it('inserts an S3 fallback only through the current runtime fence', async () => {
    query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ upload_id: '01900000-0000-7000-8000-000000000216' }],
    });

    await expect(
      new WorkerRuntimeDatabaseService().registerS3BackupFallbackUpload({
        account_id: accountId,
        bucket: 'backup',
        object_key: 'media/file.bin',
        file_name: 'file.bin',
        content_type: 'application/octet-stream',
        size_bytes: 42,
        primary_attempts: 3,
        backup_attempts: 1,
      })
    ).resolves.toBeUndefined();

    const sql = String(query.mock.calls[0]?.[0]);
    const parameters = query.mock.calls[0]?.[1] as unknown[];
    expect(sql).toContain('register_whatsapp_worker_s3_backup');
    expect(parameters.slice(0, 7)).toEqual([
      workerId,
      accountId,
      'wwebjs',
      9,
      writerEpoch,
      'b'.repeat(64),
      '0123456789ab',
    ]);
  });

  it('rejects an S3 fallback insert from a stale runtime', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      new WorkerRuntimeDatabaseService().registerS3BackupFallbackUpload({
        account_id: accountId,
        bucket: 'backup',
        object_key: 'media/file.bin',
      })
    ).rejects.toThrow('worker_runtime_database_fence_rejected');
  });

  it('reads typing configuration only through the current runtime fence', async () => {
    query.mockResolvedValueOnce({
      rows: [{ value: null, worker_config_status_id: null }],
    });

    await expect(
      new WorkerRuntimeDatabaseService().getTypingSimulationConfig(
        workerId,
        accountId
      )
    ).resolves.toEqual(expect.objectContaining({ enabled: true, speed: 50 }));

    expect(String(query.mock.calls[0]?.[0])).toContain(
      'read_whatsapp_worker_typing_config'
    );
  });

  it('rejects typing configuration reads from a stale runtime', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(
      new WorkerRuntimeDatabaseService().getTypingSimulationConfig(
        workerId,
        accountId
      )
    ).rejects.toThrow('worker_runtime_database_fence_rejected');
  });

  it('rejects cross-worker and cross-account reads before PostgreSQL is called', async () => {
    const otherWorker = '01900000-0000-7000-8000-000000000217';
    const otherAccount = '01900000-0000-7000-8000-000000000218';

    await expect(
      new WorkerRuntimeDatabaseService().getTypingSimulationConfig(
        otherWorker,
        accountId
      )
    ).rejects.toThrow('worker_runtime_database_scope_rejected');
    await expect(
      new WorkerRuntimeDatabaseService().registerS3BackupFallbackUpload({
        account_id: otherAccount,
        bucket: 'backup',
        object_key: 'cross-account.bin',
      })
    ).rejects.toThrow('worker_runtime_database_scope_rejected');
    expect(query).not.toHaveBeenCalled();
  });
});
