import { ESortOrder } from '@core/common/enums/ESortOrder';
import { Static, Type } from '@sinclair/typebox';

export const workerConnectionLogsRequestSchema = Type.Object({
  worker_id: Type.String(),
});

export const workerConnectionLogsQuerySchema = Type.Object({
  from: Type.Optional(Type.Integer({ default: 0, minimum: 0 })),
  size: Type.Optional(Type.Integer({ default: 100, minimum: 1, maximum: 200 })),
  period_hours: Type.Optional(
    Type.Union([Type.Literal(24), Type.Literal(72), Type.Literal(168)], {
      default: 24,
    })
  ),
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
