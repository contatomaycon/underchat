import { Static, Type } from '@sinclair/typebox';

export const workerConnectionLogsResponseSchema = Type.Object({
  status: Type.Union([Type.String(), Type.Null()]),
  code: Type.Union([Type.String(), Type.Number(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
  date: Type.String(),
});

export type WorkerConnectionLogsResponse = Static<
  typeof workerConnectionLogsResponseSchema
>;
