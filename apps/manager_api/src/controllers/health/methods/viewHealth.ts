import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';
import { workerCommandTelemetryStore } from '@core/services/workerCommandTelemetryStore';
import { sessionStorageMigrationTelemetryStore } from '@core/services/sessionStorageMigrationTelemetryStore';
import { WorkerCommandOperationalBarrierService } from '@core/services/workerCommandOperationalBarrier.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { workerCommandPlaneReadinessRegistry } from '../../../plugins/shared/workerCommandPlaneReadiness';

export const viewHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const commandPlane = workerCommandPlaneReadinessRegistry.snapshot();
  let barrier:
    | {
        available: true;
        ready: boolean;
        state: 'active' | 'paused';
        generation: number;
        active_permits: number;
        checked_at: string;
        last_error: null;
      }
    | {
        available: false;
        ready: false;
        state: 'unavailable';
        generation: null;
        active_permits: null;
        checked_at: string;
        last_error: ReturnType<typeof workerErrorDiagnostics>;
      };

  try {
    const status = await container
      .resolve(WorkerCommandOperationalBarrierService)
      .getStatus();
    barrier = {
      available: true,
      ready: status.state === 'active',
      state: status.state,
      generation: status.generation,
      active_permits: status.active_permits,
      checked_at: new Date().toISOString(),
      last_error: null,
    };
  } catch (error) {
    barrier = {
      available: false,
      ready: false,
      state: 'unavailable',
      generation: null,
      active_permits: null,
      checked_at: new Date().toISOString(),
      last_error: workerErrorDiagnostics(error),
    };
  }

  const ready = commandPlane.ready && barrier.ready;
  return sendResponse(reply, {
    httpStatusCode: ready
      ? EHTTPStatusCode.ok
      : EHTTPStatusCode.service_unavailable,
    data: {
      ready,
      command_plane: commandPlane,
      worker_command_operational_barrier: barrier,
      worker_command_telemetry: workerCommandTelemetryStore.snapshot(),
      session_storage_migration_telemetry:
        sessionStorageMigrationTelemetryStore.snapshot(),
    },
  });
};
