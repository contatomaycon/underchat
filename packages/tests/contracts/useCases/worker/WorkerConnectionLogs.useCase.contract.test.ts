import 'reflect-metadata';
import { WorkerConnectionLogsUseCase } from '@core/useCases/worker/WorkerConnectionLogs.useCase';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';

const t = ((key: string) => key) as never;

const baseHealth: Omit<
  WorkerConnectionHealthResponse,
  'logs' | 'logs_has_more'
> = {
  generated_at: '2026-08-16T14:00:00.000Z',
  channel: {
    id: 'worker-1',
    name: 'Channel',
    number: null,
    worker_status: { id: 'status-1', name: 'online' },
    server_name: null,
    connection_date: null,
    last_connection_check_at: null,
    created_at: null,
    updated_at: null,
  },
  current_status: null,
  session: {
    state: 'ready',
    generation: 1,
    active_revision_id: '1',
    active_revision_status: 'active',
    active_revision_size_bytes: 10,
    schema_version: 17,
    last_persisted_at: null,
    last_error_at: null,
    revision_promoted_at: null,
    revision_count: 1,
    failed_revision_count: 0,
    protected_record_count: 1,
    artifact_count: 0,
    artifact_size_bytes: 0,
    device_registered: true,
  },
  lease: {
    active: false,
    acquired_at: null,
    heartbeat_at: null,
    expires_at: null,
  },
  metrics: {
    period_hours: 24,
    window_started_at: '2026-08-15T14:00:00.000Z',
    window_ended_at: '2026-08-16T14:00:00.000Z',
    availability_percentage: null,
    observed_seconds: 0,
    online_seconds: 0,
    offline_seconds: 0,
    status_changes: 0,
    disconnections: 0,
    reconnections: 0,
    current_uptime_seconds: null,
    last_downtime_seconds: null,
  },
  timeline: [],
  events: [],
};

function makeUseCase(input: {
  sessionStorage: EWorkerSessionStorage;
  workerType: EWorkerType;
}) {
  const elasticDatabaseService = {
    select: jest.fn(async () => ({
      hits: {
        hits: [
          {
            _source: {
              status: 'online',
              code: 200,
              message: 'BaileysConnectionService disconnected',
              date: '2026-08-16T14:00:00.000Z',
              qrcode: 'must-not-leak',
            },
          },
          {
            _source: {
              status: 'offline',
              code: 500,
              message: 'Disconnected',
              date: '2026-08-16T13:00:00.000Z',
            },
          },
        ],
      },
    })),
  };
  const workerService = {
    viewWorker: jest.fn(async () => ({
      session_storage: input.sessionStorage,
      type: { id: input.workerType, name: 'provider' },
    })),
  };
  const healthRepository = {
    view: jest.fn(async () => baseHealth),
  };
  const useCase = new WorkerConnectionLogsUseCase(
    elasticDatabaseService as never,
    workerService as never,
    healthRepository as never
  );

  return { useCase, elasticDatabaseService, healthRepository };
}

describe('WorkerConnectionLogsUseCase database health contract', () => {
  it.each([EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.whatsmeow])(
    'supports the %s database-backed provider',
    async (workerType) => {
      const { useCase, healthRepository } = makeUseCase({
        sessionStorage: EWorkerSessionStorage.postgres,
        workerType,
      });

      const result = await useCase.execute(t, 'account-1', 'worker-1', {
        size: 1,
        period_hours: 72,
      });

      expect(healthRepository.view).toHaveBeenCalledWith({
        accountId: 'account-1',
        workerId: 'worker-1',
        periodHours: 72,
      });
      expect(result.logs).toEqual([
        {
          status: 'online',
          code: 200,
          message: 'connection_service disconnected',
          date: '2026-08-16T14:00:00.000Z',
        },
      ]);
      expect(result.logs[0]).not.toHaveProperty('qrcode');
      expect(JSON.stringify(result)).not.toMatch(/baileys|wwebjs|whatsmeow/i);
      expect(result.logs_has_more).toBe(true);
    }
  );

  it('rejects legacy-volume channels before reading health or logs', async () => {
    const { useCase, elasticDatabaseService, healthRepository } = makeUseCase({
      sessionStorage: EWorkerSessionStorage.legacy_volume,
      workerType: EWorkerType.baileys,
    });

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {})
    ).rejects.toThrow('worker_connection_health_database_only');
    expect(healthRepository.view).not.toHaveBeenCalled();
    expect(elasticDatabaseService.select).not.toHaveBeenCalled();
  });
});
