import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

const workerStatusSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

const workerTypeSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

const workerServerSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

const workerAccountSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
});

export const listWorkerResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  status: Type.Union([workerStatusSchema, Type.Null()]),
  type: Type.Union([workerTypeSchema, Type.Null()]),
  server: Type.Union([workerServerSchema, Type.Null()]),
  account: Type.Union([workerAccountSchema, Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export const listWorkerFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listWorkerResponseSchema),
});

export type ListWorkerResponse = Static<typeof listWorkerResponseSchema>;
export type ListWorkerFinalResponse = Static<
  typeof listWorkerFinalResponseSchema
>;
