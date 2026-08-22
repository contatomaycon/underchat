import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { Static, Type } from '@sinclair/typebox';

export const disconnectWorkerConnectionDataSchema = Type.Object({
  worker_id: Type.String({ format: 'uuid' }),
  worker_status_id: Type.Literal(EWorkerStatus.disponible),
  session_removed: Type.Literal(true),
  disconnected_user: Type.Literal(true),
  runtime_generation: Type.Integer({ minimum: 1 }),
  container_id: Type.Union([Type.String(), Type.Null()]),
  worker_status_observed_at: Type.String({ format: 'date-time' }),
  debug_trace_id: Type.Optional(Type.String()),
});

export type DisconnectWorkerConnectionResponse = Static<
  typeof disconnectWorkerConnectionDataSchema
>;
