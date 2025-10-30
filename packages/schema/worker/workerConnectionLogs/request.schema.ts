import { ESortOrder } from '@core/common/enums/ESortOrder';
import { Static, Type } from '@sinclair/typebox';

export const workerConnectionLogsRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export const workerConnectionLogsQuerySchema = Type.Object({
  from: Type.Optional(Type.Number({ default: 0 })),
  size: Type.Optional(Type.Number({ default: 100 })),
  sort: Type.Optional(
    Type.Union([Type.Literal(ESortOrder.asc), Type.Literal(ESortOrder.desc)])
  ),
});

export type WorkerConnectionLogsRequest = Static<
  typeof workerConnectionLogsRequestSchema
>;
export type WorkerConnectionLogsQuery = Static<
  typeof workerConnectionLogsQuerySchema
>;
